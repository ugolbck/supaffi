import { Prisma } from "@prisma/client";
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
import { listInvoiceLines, referredInvoiceBase, type ReferredRevenue } from "../referredRevenue";
import { invoiceLinesBeforeTax } from "../saleBase";
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

type Earned = Extract<ReferredRevenue, { kind: "earned" }>;

// Logs the one line a non-earning outcome gets and reports whether the caller
// should stop. Shared by the first read and the recompute after a legacy row
// learns its products, so a recompute that turns out unreadable or off Stripe
// is never quietly replaced by the stale figure computed before the fill.
function earnedOrLog(invoiceId: string, revenue: ReferredRevenue): Earned | null {
  if (revenue.kind === "no_tax_breakdown") {
    console.error(`[worker] invoice ${invoiceId} carries no tax breakdown, so no commission was recorded for it`);
    return null;
  }
  if (revenue.kind === "unreadable") {
    console.error(`[worker] invoice ${invoiceId} ${revenue.reason}, so no commission was recorded for it`);
    return null;
  }
  if (revenue.kind === "off_stripe") {
    // amount_paid already counts a payment made outside Stripe, so an invoice
    // paid entirely that way has nothing left to scale a commission on.
    console.warn(`[worker] invoice ${invoiceId} was paid outside Stripe, so no commission was recorded for it`);
    return null;
  }
  return revenue;
}

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

  // amount_paid_off_stripe is expandable, and Stripe never sends an
  // expandable field's value on a webhook payload: "Objekte, die in
  // Ereignissen gesendet werden, sind immer in ihrer Minimalform" (Stripe
  // docs, expand.md). So it has to be read back here, never trusted from
  // `invoice`. A failed read throws, so the event is retried.
  const invoiceRead = await stripe.invoices.retrieve(invoice.id, { expand: ["amount_paid_off_stripe"] });
  if (typeof invoiceRead.amount_paid_off_stripe !== "number") {
    // Stripe answered without the field even when it was asked for, which
    // this pinned API version is not documented to do. Earning on an
    // unscaled amount_paid risks paying on money moved outside Stripe, so
    // this invoice earns nothing instead.
    console.error(
      `[worker] invoice ${invoice.id} did not answer amount_paid_off_stripe when read with expand, so no commission was recorded for it`
    );
    return;
  }
  // total_excluding_tax, total_taxes and shipping_cost are not expandable and
  // stay as the webhook sent them; only the figures the out-of-band read
  // exists for are replaced.
  const invoiceForBase = {
    ...invoice,
    total: invoiceRead.total,
    amount_paid: invoiceRead.amount_paid,
    amount_paid_off_stripe: invoiceRead.amount_paid_off_stripe,
  };

  // Earned only on this subscription's own lines for the products its referral
  // bought, before tax and scaled to what was paid in money, see
  // referredRevenue.ts. An invoice whose tax or lines cannot be read is logged
  // and earns nothing; returning normally stops a retry that could never
  // succeed. A failed read of the lines throws, so the event is retried.
  const lines = await listInvoiceLines(stripe, invoice.id);
  const revenue = earnedOrLog(
    invoice.id,
    referredInvoiceBase(invoiceForBase, lines, subscriptionId, referred.stripeProductIds)
  );
  if (!revenue) return;

  let earned = revenue;
  if (referred.stripeProductIds.length === 0) {
    // Recorded before products were stored, or when Stripe could not say. The
    // products this renewal bills are kept from now on. If another event kept
    // a different set a moment earlier, this invoice is measured against that.
    const stored = await fillStripeProductIds(referred.id, revenue.productIds);
    if (stored.join() !== revenue.productIds.join()) {
      const again = earnedOrLog(invoice.id, referredInvoiceBase(invoiceForBase, lines, subscriptionId, stored));
      // Never falls back to the figure computed against the stale, empty
      // product list: if the recompute against what is now stored cannot
      // earn, this invoice earns nothing, not the earlier guess.
      if (!again) return;
      earned = again;
    }
  }
  if (earned.otherProductIds.length > 0) {
    console.warn(
      `[worker] invoice ${invoice.id} bills ${earned.otherProductIds.join(", ")} on subscription ${subscriptionId}, which its referral did not buy, so those lines earned nothing`
    );
  }
  const baseMinor = earned.baseMinor;

  // The referred base in charge units (the base is pre-tax and already scaled
  // to what was paid; grossing it back up by total/linesBeforeTax restates it
  // in the same units as the charge, which includes tax). A refund then takes
  // itself out of this share first, never out of a one-off item or another
  // product billed on the same charge (see chargeRefunded.ts). Null when the
  // pre-tax total cannot be read; that case never reaches here since
  // referredInvoiceBase would already have answered no_tax_breakdown.
  const linesBeforeTax = invoiceLinesBeforeTax(invoiceForBase);
  const referredChargeMinor =
    linesBeforeTax && linesBeforeTax > 0
      ? new Prisma.Decimal(baseMinor)
          .mul(invoiceForBase.total)
          .div(linesBeforeTax)
          .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
          .toNumber()
      : null;

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

  // Never more than the charge itself: grossing baseMinor back up can round
  // past the charge amount when a shipping or rounding difference separates
  // the invoice's total from what the charge actually moved.
  const cappedReferredChargeMinor =
    referredChargeMinor !== null && charge ? Math.min(referredChargeMinor, charge.amount) : referredChargeMinor;

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
        referredChargeMinor: cappedReferredChargeMinor,
        // amount, grossAmount (the figure a later refund prorates against),
        // status, voidedAt, voidReason and disputeOpenedAt.
        ...commissionFieldsAtCreation({ amount, flagReason, charge, dispute, referredChargeMinor: cappedReferredChargeMinor }),
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
