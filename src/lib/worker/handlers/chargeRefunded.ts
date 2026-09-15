import { Prisma } from "@prisma/client";
import type { Merchant, Commission } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeClientFor } from "@/lib/stripe";
import { readStoredReferredShare } from "../referredEarning";

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
      referredChargeMinor: readStoredReferredShare(commission.referredChargeMinor),
    })
  );
}

/**
 * Takes a refund or a lost chargeback back out of the commission on a payment.
 *
 * Scoped to the Merchant whose webhook this is, so a payment reference that
 * happens to match another Merchant's commission is ignored rather than voided.
 *
 * A paid commission is final. A refund or lost chargeback that lands after
 * payout is the merchant's loss and is never recovered from the affiliate, so
 * that case writes nothing and logs one line. The holding period is what
 * protects the merchant.
 *
 * Every write names the status it expects. The status read a moment ago can
 * change underneath (the Owner marks the commission paid, or voids it), and an
 * update by id alone would then void or lower a row that has already been
 * paid out. When nothing was written, the row is read again so that a payout
 * in between is logged the same way.
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
  // Either this payment never earns a commission (excluded, unattributed), or
  // its sale event has not been processed yet. The second needs nothing kept
  // here: Stripe's refunded total on the charge is cumulative, and the
  // creation handlers read it when they finally write the row.
  if (!commission) return;

  if (commission.status === "PAID") {
    logPaidIsFinal(commission.id, voidReason);
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
  // status moved since the read. Only a payout in between is worth a log line.
  const current = await db.commission.findUnique({ where: { id: commission.id }, select: { status: true } });
  if (current?.status === "PAID") logPaidIsFinal(commission.id, voidReason);
}

// One line per event, so an operator reading the log can see which refunds
// the merchant absorbed. A redelivered event logs again, which is harmless.
function logPaidIsFinal(commissionId: string, cause: string): void {
  console.info(
    `[worker] ${cause} on commission ${commissionId} arrived after it was paid. A paid commission is final, so nothing changed.`
  );
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
 *
 * The charge includes tax and the commission does not, and the ratio is still
 * right: tax is charged in proportion to the price, so a refund of a quarter of
 * the charge returns a quarter of the goods and a quarter of the tax. A refund
 * of only the shipping, which the commission never included, is prorated like
 * any other; that is rare and errs towards the merchant. An invoice paid by
 * several charges is prorated against the one refunded charge, which overstates
 * the refund (finding I-3, a later release).
 *
 * The reverse case is not handled specially either: a refund that leaves out
 * tax or shipping (a 60.00 charge of 50.00 goods plus 10.00 shipping, refunding
 * just the 50.00) still prorates against the whole charge, so it keeps 1/6 of
 * the commission where it could be argued the sale should void instead. That
 * predates this release and errs toward the affiliate, so it is left as is for
 * a later release.
 *
 * Since F4 the commission on a renewal is earned on the referred share of the
 * charge only, not the whole thing: a charge can bill a referred plan next to
 * an add-on or another product nobody referred. Prorating against the whole
 * charge then left commission on money refunded from a part that was never
 * referred. When `referredChargeMinor` is recorded, refunds are prorated
 * against that share instead, and taken out of it first: `remaining =
 * max(0, referredChargeMinor - refunded)`. `refunded` is the charge's whole
 * cumulative total, with no way to tell which part of it a merchant meant, so
 * a refund of only the non-referred share still counts fully against the
 * referred share here and lowers or voids the commission the same as any
 * other refund of that size. That is the accepted, merchant-safe cost of not
 * tracking which part of a refund a merchant meant. Rows without the value
 * (checkout, and rows written before this existed) keep prorating against
 * the whole charge.
 */
export function prorateCommission(input: {
  gross: Prisma.Decimal.Value;
  chargeTotal: number;
  refunded: number;
  /** The referred share of the charge, in minor units, when the row records one. */
  referredChargeMinor?: number | null;
}): ReversalOutcome {
  if (input.chargeTotal <= 0) return { void: true };
  const denominator = input.referredChargeMinor ?? input.chargeTotal;
  if (denominator <= 0) return { void: true };
  const remaining = denominator - input.refunded;
  if (remaining <= 0) return { void: true };
  const amount = new Prisma.Decimal(input.gross)
    .mul(remaining)
    .div(denominator)
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
