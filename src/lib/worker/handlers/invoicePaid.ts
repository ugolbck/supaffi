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
import { invoiceBaseMinor } from "../saleBase";
import { checkPaymentMethodOverlap, checkSelfReferralEmail, resolveInvoiceFingerprint } from "../selfReferral";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { claimFirstPayment, findReferredSubscription, idOf, subscriptionIdOf } from "../referredSubscription";

export async function handleInvoicePaid(merchant: Merchant, invoice: Stripe.Invoice): Promise<void> {
  const stripeCustomerId = idOf(invoice.customer);
  if (!stripeCustomerId) return;

  // The first invoice of a subscription started through Checkout belongs to
  // checkout.session.completed, which matches it by the Referral Token this
  // invoice doesn't carry. After a free trial that first invoice is $0, and
  // the first paid invoice comes later as subscription_cycle.
  if (invoice.billing_reason === "subscription_create") return;

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

  // Earned on the renewal before tax and shipping, scaled to what was paid in
  // money, see saleBase.ts. An invoice that does not say how much tax it
  // carried is logged and skipped rather than paid on a total with the tax in
  // it; returning normally stops a retry that could never succeed.
  const baseMinor = invoiceBaseMinor(invoice);
  if (baseMinor === null) {
    console.error(`[worker] invoice ${invoice.id} carries no tax breakdown, so no commission was recorded for it`);
    return;
  }

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
    const commission = await db.commission.create({
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
    if (dispute === "unknown") {
      console.warn(
        `[worker] commission ${commission.id} was created while its disputes could not be read, so it is held until a dispute event or the owner releases it.`
      );
    }
  } catch (err) {
    // Redelivery of the same invoice.paid event.
    if (!isUniqueConstraintError(err)) throw err;
  }
}
