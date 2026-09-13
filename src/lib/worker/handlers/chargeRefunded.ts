import { Prisma } from "@prisma/client";
import type { Merchant, Commission } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeClientFor } from "@/lib/stripe";

export type ReversalOutcome = { void: true } | { void: false; amount: number };

const UNPAID_STATUSES = ["PENDING", "PAYABLE", "FLAGGED"] as const;

export async function handleChargeRefunded(merchant: Merchant, charge: Stripe.Charge): Promise<void> {
  const stripe = stripeClientFor(merchant);
  const paymentRef = await resolvePaymentReferenceId(stripe, {
    legacyInvoice: (charge as unknown as { invoice?: string | { id: string } | null }).invoice ?? null,
    paymentIntentId: idOf(charge.payment_intent),
  });
  if (!paymentRef) return; // couldn't trace this charge to anything Supaffi tracks

  await reverseCommission(merchant, paymentRef, "refund", (commission) =>
    prorateCommission({
      gross: commission.grossAmount ?? commission.amount,
      chargeTotal: charge.amount,
      refunded: charge.amount_refunded,
    })
  );
}

/**
 * Takes a refund or a lost chargeback back out of the commission on a payment.
 *
 * Scoped to the Merchant whose webhook this is, so a payment reference that
 * happens to match another Merchant's commission is ignored rather than voided.
 *
 * Every write names the status it expects. The status read a moment ago can
 * change underneath (the Owner marks the commission paid, or voids it), and an
 * update by id alone would then void a row that has already been paid out, so
 * the money would never be clawed back. When nothing was written, the row is
 * read again and a commission that became PAID takes the clawback path.
 *
 * A partial reduction never raises the amount. Stripe does not guarantee event
 * order, so an older refund event carrying a smaller cumulative refund can land
 * after a newer one, and writing its prorated figure would hand back money the
 * later refund already took.
 */
export async function reverseCommission(
  merchant: Merchant,
  paymentRef: string,
  voidReason: string,
  outcomeFor: (commission: Commission) => ReversalOutcome
): Promise<void> {
  const commission = await db.commission.findUnique({
    where: { stripePaymentRef: paymentRef, affiliate: { merchantId: merchant.id } },
  });
  if (!commission) return; // this payment never generated a Commission (excluded, unattributed, etc.)

  if (commission.status === "PAID") {
    await createClawbackAdjustment(commission, outcomeFor(commission));
    return;
  }
  if (commission.status === "VOIDED") return; // idempotent no-op (redelivered event)

  const outcome = outcomeFor(commission);
  const { count } = outcome.void
    ? await db.commission.updateMany({
        where: { id: commission.id, status: { in: [...UNPAID_STATUSES] } },
        data: { status: "VOIDED", voidedAt: new Date(), voidReason },
      })
    : await db.commission.updateMany({
        where: {
          id: commission.id,
          status: { in: [...UNPAID_STATUSES] },
          amount: { gt: new Prisma.Decimal(outcome.amount) },
        },
        data: { amount: new Prisma.Decimal(outcome.amount), voidReason: "partial refund" },
      });
  if (count > 0) return;

  // Nothing written: the amount was already at or below this figure, or the
  // status moved since the read. Only a payout in between needs acting on.
  const current = await db.commission.findUnique({ where: { id: commission.id } });
  if (current?.status === "PAID") {
    await createClawbackAdjustment(current, outcomeFor(current));
  }
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
  gross: Prisma.Decimal.Value;
  chargeTotal: number;
  refunded: number;
}): ReversalOutcome {
  if (input.chargeTotal <= 0) return { void: true };
  const remaining = input.chargeTotal - input.refunded;
  if (remaining <= 0) return { void: true };
  const amount = new Prisma.Decimal(input.gross)
    .mul(remaining)
    .div(input.chargeTotal)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (amount.lte(0)) return { void: true };
  return { void: false, amount: amount.toNumber() };
}

export function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

// Traces a payment back to the Invoice (subscription payments) or, for a
// one-time purchase with no Invoice at all, the PaymentIntent — either way
// this is Commission.stripePaymentRef's matching key.
//
// In the Stripe API version this SDK is pinned to (2026-07-29.dahlia),
// Charge no longer has a direct `invoice` field — it was removed upstream
// in favor of Invoice.payments. Checked defensively anyway first: a
// Merchant's own webhook endpoint may still be configured on an older API
// version where the raw payload still carries it, even though this SDK's
// types don't declare it.
export async function resolvePaymentReferenceId(
  stripe: Stripe,
  payment: { legacyInvoice: string | { id: string } | null; paymentIntentId: string | null }
): Promise<string | null> {
  const legacyInvoiceId = idOf(payment.legacyInvoice);
  if (legacyInvoiceId) return legacyInvoiceId;

  const { paymentIntentId } = payment;
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
async function createClawbackAdjustment(original: Commission, outcome: ReversalOutcome): Promise<void> {
  const paid = original.amount;
  const owed = outcome.void ? paid : paid.sub(outcome.amount);

  const existing = await db.commission.findMany({
    where: { adjustsCommissionId: original.id },
    select: { amount: true },
  });
  // Adjustment rows carry a negative amount; the magnitude is what it took back.
  const alreadyClawedBack = existing.reduce((total, row) => total.add(row.amount.abs()), new Prisma.Decimal(0));
  const delta = owed.sub(alreadyClawedBack).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (delta.lte(0)) return;

  await db.commission.create({
    data: {
      affiliateId: original.affiliateId,
      clickId: original.clickId,
      adjustsCommissionId: original.id,
      stripePaymentRef: null, // not tied to a new payment
      amount: delta.negated(),
      currency: original.currency,
      // Ready to net against the Affiliate's next payout immediately, no
      // Holding Period — this isn't new money that itself needs time to
      // prove out before a refund, it already is the refund.
      status: "PAYABLE",
      payableAt: new Date(),
    },
  });
}
