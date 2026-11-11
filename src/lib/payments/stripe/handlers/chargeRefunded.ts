import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { stripeClientFor } from "@/lib/payments/stripe/client";
import { readStoredReferredShare } from "@/lib/worker/referredShare";
import { prorateCommission, reverseCommission } from "@/lib/worker/reversal";

export async function handleChargeRefunded(merchant: Merchant, charge: Stripe.Charge): Promise<void> {
  const stripe = stripeClientFor(merchant);
  const paymentRefs = await resolvePaymentReferenceIds(stripe, {
    legacyInvoice: (charge as unknown as { invoice?: string | { id: string } | null }).invoice ?? null,
    paymentIntentId: idOf(charge.payment_intent),
  });
  if (paymentRefs.length === 0) return; // couldn't trace this charge to anything Supaffi tracks

  await reverseCommission(merchant, paymentRefs, "refund", (commission) =>
    prorateCommission({
      gross: commission.grossAmount ?? commission.amount,
      chargeTotal: charge.amount,
      refunded: charge.amount_refunded,
      referredChargeMinor: readStoredReferredShare(commission.referredChargeMinor),
    })
  );
}

export function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

// Every reference a payment's commission can be stored under, in the order to
// try them: the Invoice first, then the PaymentIntent.
//
// A subscription payment is stored under its Invoice. A one-time purchase is
// stored under its PaymentIntent, even when Stripe also issued a post-purchase
// invoice for it, because Stripe does not document linking that invoice back to
// the payment. Before 0.2.7 such a sale was stored under the invoice, so the
// invoice is still tried first and those rows are still found.
//
// In the Stripe API version this SDK is pinned to (2026-09-30.endive), Charge
// no longer has a direct `invoice` field; it was removed upstream in favor of
// Invoice.payments. It is checked first anyway: a Merchant's account may still
// send events on an older API version whose payload carries it, even though
// this SDK's types don't declare it.
export async function resolvePaymentReferenceIds(
  stripe: Stripe,
  payment: { legacyInvoice: string | { id: string } | null; paymentIntentId: string | null }
): Promise<string[]> {
  const { paymentIntentId } = payment;
  let invoiceId = idOf(payment.legacyInvoice);

  if (!invoiceId && paymentIntentId) {
    const payments = await stripe.invoicePayments.list({
      payment: { type: "payment_intent", payment_intent: paymentIntentId },
      limit: 1,
    });
    const match = payments.data[0];
    if (match) invoiceId = typeof match.invoice === "string" ? match.invoice : match.invoice.id;
  }

  return [invoiceId, paymentIntentId].filter((ref): ref is string => ref !== null);
}
