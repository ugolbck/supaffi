import type { Merchant, Commission } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeClientFor } from "@/lib/stripe";

export async function handleChargeRefunded(merchant: Merchant, charge: Stripe.Charge): Promise<void> {
  const stripe = stripeClientFor(merchant);
  const paymentRef = await resolvePaymentReferenceId(stripe, charge);
  if (!paymentRef) return; // couldn't trace this charge to anything Supaffi tracks

  const commission = await db.commission.findUnique({ where: { stripePaymentRef: paymentRef } });
  if (!commission) return; // this payment never generated a Commission (excluded, unattributed, etc.)

  if (commission.status === "PAID") {
    await createClawbackAdjustment(commission);
    return;
  }
  if (commission.status === "PENDING" || commission.status === "PAYABLE" || commission.status === "FLAGGED") {
    await db.commission.update({
      where: { id: commission.id },
      data: { status: "VOIDED", voidedAt: new Date(), voidReason: "refund" },
    });
  }
  // already VOIDED — idempotent no-op (redelivered event)
}

// Traces a Charge back to the Invoice (subscription payments) or, for a
// one-time purchase with no Invoice at all, the PaymentIntent — either way
// this is Commission.stripePaymentRef's matching key.
//
// In the Stripe API version this SDK is pinned to (2026-07-29.dahlia),
// Charge no longer has a direct `invoice` field — it was removed upstream
// in favor of Invoice.payments. Checked defensively anyway first: a
// Merchant's own webhook endpoint may still be configured on an older API
// version where the raw payload still carries it, even though this SDK's
// types don't declare it.
async function resolvePaymentReferenceId(stripe: Stripe, charge: Stripe.Charge): Promise<string | null> {
  const legacyInvoice = (charge as unknown as { invoice?: string | { id: string } | null }).invoice;
  if (legacyInvoice) return typeof legacyInvoice === "string" ? legacyInvoice : legacyInvoice.id;

  const paymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : (charge.payment_intent?.id ?? null);
  if (!paymentIntentId) return null;

  const payments = await stripe.invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntentId },
    limit: 1,
  });
  const match = payments.data[0];
  if (match) return typeof match.invoice === "string" ? match.invoice : match.invoice.id;

  // No Invoice at all — a one-time ("payment" mode) Checkout Session. That
  // path stores the PaymentIntent ID itself as stripePaymentRef, so it's
  // the correct fallback key here too.
  return paymentIntentId;
}

async function createClawbackAdjustment(original: Commission): Promise<void> {
  await db.commission.create({
    data: {
      affiliateId: original.affiliateId,
      clickId: original.clickId,
      adjustsCommissionId: original.id,
      stripePaymentRef: null, // not tied to a new payment
      amount: original.amount.negated(),
      currency: original.currency,
      // Ready to net against the Affiliate's next payout immediately, no
      // Holding Period — this isn't new money that itself needs time to
      // prove out before a refund, it already is the refund.
      status: "PAYABLE",
      payableAt: new Date(),
    },
  });
}
