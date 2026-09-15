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

/**
 * The commission on a payment, trying each of its references in order.
 *
 * A one-time sale with a post-purchase invoice was stored under that invoice
 * before 0.2.7 and under its PaymentIntent since, so a refund or dispute has to
 * try both. The checkout handler never writes both for one sale, so the first
 * match is the only one. The whole row is returned, so a refund still prorates
 * against its referred share when it records one.
 *
 * Scoped to the Merchant whose webhook this is, so a payment reference that
 * happens to match another Merchant's commission is ignored.
 */
export async function findCommissionForPayment(
  merchant: Merchant,
  paymentRefs: readonly string[]
): Promise<Commission | null> {
  for (const stripePaymentRef of paymentRefs) {
    const commission = await db.commission.findUnique({
      where: { stripePaymentRef, affiliate: { merchantId: merchant.id } },
    });
    if (commission) return commission;
  }
  return null;
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
  paymentRefs: readonly string[],
  voidReason: string,
  outcomeFor: (commission: Commission) => ReversalOutcome
): Promise<void> {
  const commission = await findCommissionForPayment(merchant, paymentRefs);
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

// Every reference a payment's commission can be stored under, in the order to
// try them: the Invoice first, then the PaymentIntent.
//
// A subscription payment is stored under its Invoice. A one-time purchase is
// stored under its PaymentIntent, even when Stripe also issued a post-purchase
// invoice for it, because Stripe does not document linking that invoice back to
// the payment. Before 0.2.7 such a sale was stored under the invoice, so the
// invoice is still tried first and those rows are still found.
//
// In the Stripe API version this SDK is pinned to (2026-07-29.dahlia), Charge
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
