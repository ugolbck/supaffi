import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeClientFor } from "@/lib/stripe";
import {
  commissionRateFor,
  computeCommissionAmount,
  computePayableAt,
  hasExclusionFlag,
  isExcluded,
  saleAmountFor,
} from "../commission";
import {
  commissionFieldsAtCreation,
  disputeStateAtCreation,
  latestChargeFor,
  paymentIntentForInvoice,
} from "../paymentState";
import { exclusionSourcesOf, retrieveInvoiceForEarning } from "../referredRevenue";
import { referredEarningOn, storableReferredShare } from "../referredEarning";
import { checkPaymentMethodOverlap, checkSelfReferralEmail, resolveInvoiceFingerprint } from "../selfReferral";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { claimFirstPayment, findReferredSubscription, idOf, subscriptionIdOf } from "../referredSubscription";
import { referralStillEarns } from "../referralDuration";
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
  await claimFirstPayment(referred, payment);

  // The duration belongs to the click, not to this subscription. A customer
  // who cancels and subscribes again through the same click, or moves to
  // another plan with a new Checkout, carries on from the click's first
  // payment instead of starting the program over. Measured after the claim
  // above, so this subscription's own first payment is part of that history.
  const program = click.affiliate.program;
  if (!(await referralStillEarns(merchant.id, click.id, program, payment))) return;

  const stripe = stripeClientFor(merchant);

  // The invoice's own flag is on the payload, so an excluded invoice stops
  // here without a call.
  if (hasExclusionFlag(invoice.metadata)) return;

  // amount_paid_off_stripe is expandable, and Stripe never sends an
  // expandable field's value on a webhook payload: "Objekte, die in
  // Ereignissen gesendet werden, sind immer in ihrer Minimalform" (Stripe
  // docs, expand.md). So it has to be read back here, never trusted from
  // `invoice`. A failed read throws, so the event is retried.
  const invoiceRead = await retrieveInvoiceForEarning(stripe, invoice.id);

  // The same read carries the subscription and the customer, so their flags
  // cost no further call. The subscription is never taken from the payload:
  // where a payload keeps it depends on the merchant's account version, and
  // even then it is only a snapshot from when the invoice was finalized, so an
  // excluded subscription earned on every renewal of an older account. Checked
  // before the lines are listed, which an excluded renewal does not need. A
  // subscription or customer Stripe did not expand is read by id, and a read
  // that fails throws, so the event is retried rather than earning on a sale
  // the merchant may have excluded.
  if (await isExcluded(stripe, exclusionSourcesOf(invoiceRead, subscriptionId, stripeCustomerId), invoice.id)) return;
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
  // bought, before tax and scaled to what was paid through Stripe, by the same
  // rule as its first payment, see referredEarning.ts.
  const earned = await referredEarningOn(stripe, invoice.id, invoiceForBase, subscriptionId, referred);
  if (!earned) return;
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

  // Never more than the charge itself: a rounding or shipping difference can
  // still separate the invoice's own total from what the charge actually
  // moved, even though referredInvoiceBase already rounds its own figure down.
  const cappedReferredChargeMinor = charge ? Math.min(earned.referredChargeMinor, charge.amount) : earned.referredChargeMinor;

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
        referredChargeMinor: storableReferredShare(cappedReferredChargeMinor),
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
