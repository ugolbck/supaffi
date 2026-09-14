import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeClientFor } from "@/lib/stripe";
import {
  commissionRateFor,
  computeCommissionAmount,
  computePayableAt,
  isExcluded,
  isPaymentWithinCommissionDuration,
  saleAmountFor,
} from "../commission";
import {
  commissionFieldsAtCreation,
  disputeStateAtCreation,
  latestChargeFor,
  paymentIntentForInvoice,
} from "../paymentState";
import { listInvoiceLines, referredInvoiceBase } from "../referredRevenue";
import { checkPaymentMethodOverlap, checkSelfReferralEmail, resolveInvoiceFingerprint } from "../selfReferral";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import {
  claimFirstPayment,
  fillStripeProductIds,
  findReferredSubscription,
  idOf,
  subscriptionIdOf,
} from "../referredSubscription";
import { createCommissionUnlessSelfReferral } from "../recordCommission";

// A renewal or a plan change is revenue of the subscription the referral
// bought. Every other billing reason earns nothing: manual, quote_accept and
// automatic_pending_invoice_item_invoice bill things the referral did not buy,
// upcoming is a preview, subscription is a reason Stripe retired, and
// subscription_threshold usage billing is left out by the owner's rule.
// subscription_create belongs to checkout.session.completed.
const EARNING_BILLING_REASONS: ReadonlySet<string> = new Set(["subscription_cycle", "subscription_update"]);

export async function handleInvoicePaid(merchant: Merchant, invoice: Stripe.Invoice): Promise<void> {
  const stripeCustomerId = idOf(invoice.customer);
  if (!stripeCustomerId) return;

  // The first invoice of a subscription started through Checkout belongs to
  // checkout.session.completed, which matches it by the Referral Token this
  // invoice doesn't carry. After a free trial that first invoice is $0, and
  // the first paid invoice comes later as subscription_cycle. Checked before
  // the first payment is claimed, so a manual invoice on a trial cannot use up
  // a one-time commission.
  if (!invoice.billing_reason || !EARNING_BILLING_REASONS.has(invoice.billing_reason)) return;

  // A $0 invoice (a trial, or one fully covered by credit) moved no money, so
  // it must not be claimed as the first payment and use up a one-time
  // commission.
  if (invoice.amount_paid <= 0 || !invoice.currency) return;

  // Only invoices of a subscription can earn. A one-off invoice for a referred
  // customer creates nothing: the affiliate referred a checkout, not every
  // future purchase on the customer's account.
  const subscriptionId = subscriptionIdOf(invoice);
  if (!subscriptionId) return;

  // Matched on the subscription a referred checkout created, scoped to the
  // Merchant whose webhook this is. Matching the customer instead paid the
  // wrong affiliate when products share a Stripe account, and paid on
  // subscriptions nobody referred.
  const referred = await findReferredSubscription(merchant, subscriptionId, stripeCustomerId);
  if (!referred) return;

  const click = referred.click;
  // The Owner confirmed a self referral on this click. Voiding that one row
  // was not enough; every later renewal would have earned again.
  if (click.fraudConfirmedAt) return;

  // Claimed before the exclusion check and the commission maths below: the
  // first payment is when money first moved on the subscription, whether or
  // not that payment earned.
  const payment = { ref: invoice.id, at: new Date(invoice.created * 1000) };
  const firstPayment = await claimFirstPayment(referred, payment);

  const program = click.affiliate.program;
  if (!isPaymentWithinCommissionDuration(program, firstPayment, payment)) return;

  const stripe = stripeClientFor(merchant);
  const subscriptionMetadata =
    invoice.parent?.type === "subscription_details"
      ? (invoice.parent.subscription_details?.metadata ?? null)
      : null;

  const excluded = await isExcluded(stripe, {
    invoiceMetadata: invoice.metadata,
    subscriptionMetadata,
    customerId: stripeCustomerId,
  });
  if (excluded) return;

  // Earned only on this subscription's own lines for the products its referral
  // bought, before tax and scaled to what was paid in money, see
  // referredRevenue.ts. An invoice whose tax or lines cannot be read is logged
  // and earns nothing; returning normally stops a retry that could never
  // succeed. A failed read of the lines throws, so the event is retried.
  const lines = await listInvoiceLines(stripe, invoice.id);
  const revenue = referredInvoiceBase(invoice, lines, subscriptionId, referred.stripeProductIds);
  if (revenue.kind === "no_tax_breakdown") {
    console.error(`[worker] invoice ${invoice.id} carries no tax breakdown, so no commission was recorded for it`);
    return;
  }
  if (revenue.kind === "unreadable") {
    console.error(`[worker] invoice ${invoice.id} ${revenue.reason}, so no commission was recorded for it`);
    return;
  }
  if (revenue.kind === "off_stripe") {
    // amount_paid already counts a payment made outside Stripe, so an invoice
    // paid entirely that way has nothing left to scale a commission on.
    console.warn(`[worker] invoice ${invoice.id} was paid outside Stripe, so no commission was recorded for it`);
    return;
  }

  let earned = revenue;
  if (referred.stripeProductIds.length === 0) {
    // Recorded before products were stored, or when Stripe could not say. The
    // products this renewal bills are kept from now on. If another event kept
    // a different set a moment earlier, this invoice is measured against that.
    const stored = await fillStripeProductIds(referred.id, revenue.productIds);
    if (stored.join() !== revenue.productIds.join()) {
      const again = referredInvoiceBase(invoice, lines, subscriptionId, stored);
      if (again.kind === "earned") earned = again;
    }
  }
  if (earned.otherProductIds.length > 0) {
    console.warn(
      `[worker] invoice ${invoice.id} bills ${earned.otherProductIds.join(", ")} on subscription ${subscriptionId}, which its referral did not buy, so those lines earned nothing`
    );
  }
  const baseMinor = earned.baseMinor;

  const affiliate = click.affiliate;
  const rate = commissionRateFor(affiliate, program);
  const amount = computeCommissionAmount(baseMinor, invoice.currency, rate);
  // A renewal covered by credit balance or discounted to nothing used to
  // leave a 0.00 row in both ledgers.
  if (amount.lte(0)) return;
  // The same two checks as the first purchase. A renewal is where a customer
  // who is really the affiliate most easily swaps in their own card, so the
  // card is checked on every one, each flagged on its own.
  let flagReason = checkSelfReferralEmail(affiliate, invoice.customer_email);
  if (!flagReason) {
    const fingerprint = await resolveInvoiceFingerprint(stripe, invoice.id);
    flagReason = await checkPaymentMethodOverlap(stripe, affiliate, fingerprint, stripeCustomerId);
  }

  // A refund or a dispute made before this event was processed is read back
  // from the charge now and folded into the row, see paymentState.ts.
  const chargeIntentId = await paymentIntentForInvoice(stripe, invoice.id);
  const charge = chargeIntentId ? await latestChargeFor(stripe, chargeIntentId) : null;
  const dispute = await disputeStateAtCreation(stripe, chargeIntentId, charge);

  try {
    // Checked against a self referral confirmed since the check above.
    const written = await createCommissionUnlessSelfReferral({
      data: {
        affiliateId: affiliate.id,
        clickId: click.id,
        stripePaymentRef: invoice.id,
        currency: invoice.currency,
        saleAmount: saleAmountFor(baseMinor, invoice.currency),
        payableAt: computePayableAt(program),
        flagReason,
        // amount, grossAmount (the figure a later refund prorates against),
        // status, voidedAt, voidReason and disputeOpenedAt.
        ...commissionFieldsAtCreation({ amount, flagReason, charge, dispute }),
      },
    });
    if (written && dispute === "unknown") {
      // The write only reports whether it happened, not the row: looked up by
      // its unique payment reference so the log still names the commission.
      const commission = await db.commission.findFirst({ where: { stripePaymentRef: invoice.id }, select: { id: true } });
      console.warn(
        `[worker] commission ${commission?.id} was created while its disputes could not be read, so it is held until a dispute event or the owner releases it.`
      );
    }
  } catch (err) {
    // Redelivery of the same invoice.paid event.
    if (!isUniqueConstraintError(err)) throw err;
  }
}
