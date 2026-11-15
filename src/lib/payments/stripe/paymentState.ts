import type Stripe from "stripe";
import { type ChargeSnapshot } from "@/lib/worker/paymentState";
import { disputeStateFor } from "@/lib/payments/stripe/disputes";
import type { DisputeState } from "@/lib/worker/disputes";
import { isTransientStripeError, stripeErrorLabel } from "@/lib/payments/stripe/errors";

/**
 * The PaymentIntent that paid an invoice. Takes the first paid payment only:
 * an invoice split across several payments is a known gap (finding I-3), left
 * for a later release.
 *
 * Throws only on an outage, so the event is retried. A key that cannot read
 * the payment answers null: the answer only decides whether an earlier refund
 * is folded into a new commission, and losing the commission over a lookup
 * that will never succeed would be worse than missing that refund.
 */
export async function paymentIntentForInvoice(stripe: Stripe, invoiceId: string): Promise<string | null> {
  try {
    const payments = await stripe.invoicePayments.list({ invoice: invoiceId, status: "paid", limit: 1 });
    const intent = payments.data[0]?.payment.payment_intent;
    return typeof intent === "string" ? intent : (intent?.id ?? null);
  } catch (err) {
    if (isTransientStripeError(err)) throw new Error(`[worker] could not reach Stripe for invoice ${invoiceId} (${stripeErrorLabel(err)}), so the event is retried`);
    console.warn(
      `[worker] could not check invoice ${invoiceId} for an earlier refund (${stripeErrorLabel(err)}). The refund check was skipped; replacing the Stripe key in settings lets Supaffi read charges.`
    );
    return null;
  }
}

/**
 * How much of a payment's charge has been refunded so far, and whether it was
 * ever disputed, according to Stripe right now.
 *
 * Expanding the charge needs Charges read, which keys made before 0.2.4 do
 * not have. Stripe does not promise one error type for that: it can come back
 * as a permission error or as an invalid request. So every failure other
 * than an outage answers null: the commission is then created exactly as it
 * was before this lookup existed. An outage throws, so the event is retried.
 */
export async function latestChargeFor(stripe: Stripe, paymentIntentId: string): Promise<ChargeSnapshot | null> {
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
    const charge = intent.latest_charge;
    if (!charge || typeof charge === "string") return null;
    return { amount: charge.amount, amountRefunded: charge.amount_refunded, disputed: charge.disputed === true };
  } catch (err) {
    if (isTransientStripeError(err)) throw new Error(`[worker] could not reach Stripe for payment ${paymentIntentId} (${stripeErrorLabel(err)}), so the event is retried`);
    console.warn(
      `[worker] could not read the charge behind payment ${paymentIntentId} (${stripeErrorLabel(err)}). The refund check was skipped; replacing the Stripe key in settings lets Supaffi read charges.`
    );
    return null;
  }
}

/**
 * Whether a new commission's sale is already disputed.
 *
 * Null when the charge could not be read: the commission is then created as it
 * was before this check existed, the same fallback as the refund check. A
 * charge Stripe says was never disputed costs no further request. A disputed
 * one lists its disputes, since `disputed` stays true after a dispute is won.
 *
 * An empty list here reads as "unknown", not "clear": a disputed charge
 * always has at least one dispute, so an empty answer is the opening event
 * having arrived, and been dropped, before this row existed, with its own
 * list not caught up yet. See disputeStateFor's `emptyMeansUnknown` for why.
 */
export async function disputeStateAtCreation(
  stripe: Stripe,
  paymentIntentId: string | null,
  charge: ChargeSnapshot | null
): Promise<DisputeState | null> {
  if (!paymentIntentId || !charge) return null;
  if (!charge.disputed) return "clear";
  return disputeStateFor(stripe, paymentIntentId, undefined, true);
}
