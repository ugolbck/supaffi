import { Prisma } from "@prisma/client";
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

  const gross = Number(commission.grossAmount ?? commission.amount);
  const outcome = prorateCommission({
    gross,
    chargeTotal: charge.amount,
    refunded: charge.amount_refunded,
  });

  if (commission.status === "PAID") {
    await createClawbackAdjustment(commission, outcome);
    return;
  }
  if (commission.status === "PENDING" || commission.status === "PAYABLE" || commission.status === "FLAGGED") {
    if (outcome.void) {
      await db.commission.update({
        where: { id: commission.id },
        data: { status: "VOIDED", voidedAt: new Date(), voidReason: "refund" },
      });
      return;
    }
    await db.commission.update({
      where: { id: commission.id },
      data: { amount: new Prisma.Decimal(outcome.amount), voidReason: "partial refund" },
    });
  }
  // already VOIDED — idempotent no-op (redelivered event)
}

/**
 * What a commission is worth after a refund.
 *
 * `refunded` and `chargeTotal` are Stripe's minor units off the Charge, and
 * `refunded` is cumulative, which is why this prorates against the original
 * commission rather than the current one: two partial refunds in a row would
 * otherwise take their cut of an already reduced figure.
 *
 * Voiding only on a full refund is the point of the change. Merchants issue
 * small partial refunds constantly, and taking the affiliate's entire
 * commission for a late discount is not defensible; see finding 17.
 */
export function prorateCommission(input: {
  gross: number;
  chargeTotal: number;
  refunded: number;
}): { void: true } | { void: false; amount: number } {
  if (input.chargeTotal <= 0) return { void: true };
  const remaining = input.chargeTotal - input.refunded;
  if (remaining <= 0) return { void: true };
  const amount = Math.round(input.gross * (remaining / input.chargeTotal) * 100) / 100;
  if (amount <= 0) return { void: true };
  return { void: false, amount };
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

// Claws back only what the refund actually took, and only the part that has
// not been clawed back already.
//
// The basis is what the affiliate was paid, `amount` on the PAID row, not the
// gross: a commission reduced by an earlier partial refund was paid out at the
// reduced figure, so charging the gross back would take more than they ever
// received.
//
// `charge.amount_refunded` is cumulative, so the total owed back is recomputed
// from scratch on every delivery and only the difference against the existing
// adjustment rows is written. Two partial refunds therefore stop overlapping,
// and a redelivered event writes nothing at all.
async function createClawbackAdjustment(
  original: Commission,
  outcome: ReturnType<typeof prorateCommission>
): Promise<void> {
  const paid = Number(original.amount);
  const owed = outcome.void ? paid : Math.round((paid - outcome.amount) * 100) / 100;

  const existing = await db.commission.findMany({
    where: { adjustsCommissionId: original.id },
    select: { amount: true },
  });
  // Adjustment rows carry a negative amount; the magnitude is what it took back.
  const alreadyClawedBack = existing.reduce((total, row) => total + Math.abs(Number(row.amount)), 0);
  const delta = Math.round((owed - alreadyClawedBack) * 100) / 100;
  if (delta <= 0) return;

  await db.commission.create({
    data: {
      affiliateId: original.affiliateId,
      clickId: original.clickId,
      adjustsCommissionId: original.id,
      stripePaymentRef: null, // not tied to a new payment
      amount: new Prisma.Decimal(delta).negated(),
      currency: original.currency,
      // Ready to net against the Affiliate's next payout immediately, no
      // Holding Period — this isn't new money that itself needs time to
      // prove out before a refund, it already is the refund.
      status: "PAYABLE",
      payableAt: new Date(),
    },
  });
}
