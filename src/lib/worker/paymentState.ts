import { Prisma } from "@prisma/client";
import type { CommissionStatus } from "@prisma/client";
import type Stripe from "stripe";
import { prorateCommission } from "./handlers/chargeRefunded";

export type ChargeSnapshot = { amount: number; amountRefunded: number };

/**
 * The PaymentIntent that paid an invoice. Takes the first paid payment only:
 * an invoice split across several payments is a known gap (finding I-3), left
 * for a later release.
 *
 * Never throws. The answer only decides whether an earlier refund is folded
 * into a new commission, and losing the commission over a failed lookup would
 * be worse than missing that refund.
 */
export async function paymentIntentForInvoice(stripe: Stripe, invoiceId: string): Promise<string | null> {
  try {
    const payments = await stripe.invoicePayments.list({ invoice: invoiceId, status: "paid", limit: 1 });
    const intent = payments.data[0]?.payment.payment_intent;
    return typeof intent === "string" ? intent : (intent?.id ?? null);
  } catch (err) {
    console.error(`[worker] could not find the payment behind invoice ${invoiceId}`, err);
    return null;
  }
}

/**
 * How much of a payment's charge has been refunded so far, according to
 * Stripe right now.
 *
 * Expanding the charge needs Charges read, which keys made before 0.2.4 do
 * not have. Stripe does not promise one error type for that: it can come back
 * as a permission error or as an invalid request. So every failure, of any
 * type, answers null: the commission is then created exactly as it was
 * before this lookup existed.
 */
export async function latestChargeFor(stripe: Stripe, paymentIntentId: string): Promise<ChargeSnapshot | null> {
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
    const charge = intent.latest_charge;
    if (!charge || typeof charge === "string") return null;
    return { amount: charge.amount, amountRefunded: charge.amount_refunded };
  } catch (err) {
    console.error(
      `[worker] could not read the charge behind ${paymentIntentId}; the commission is recorded without checking for an earlier refund`,
      err
    );
    return null;
  }
}

/**
 * What a commission is written with when it is first created.
 *
 * A refund can reach Supaffi before the sale it belongs to, most often when
 * the sale's event failed and is being retried. The refund handler finds no
 * commission then and does nothing, which is safe because Stripe keeps the
 * charge's refunded total cumulative: reading it here, at creation, picks up
 * every refund made so far. The row is written already reduced or voided in
 * the same insert, so there is no moment where the full figure exists.
 *
 * The rules match the refund handler's: a partial refund lowers the amount
 * and keeps the status, flag included; a full one voids.
 */
export function commissionFieldsAtCreation(input: {
  amount: Prisma.Decimal;
  flagReason: string | null;
  charge: ChargeSnapshot | null;
  now?: Date;
}): {
  amount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
  status: CommissionStatus;
  voidedAt: Date | null;
  voidReason: string | null;
} {
  const status: CommissionStatus = input.flagReason ? "FLAGGED" : "PENDING";
  const untouched = { amount: input.amount, grossAmount: input.amount, status, voidedAt: null, voidReason: null };
  if (!input.charge || input.charge.amountRefunded <= 0) return untouched;

  const outcome = prorateCommission({
    gross: input.amount,
    chargeTotal: input.charge.amount,
    refunded: input.charge.amountRefunded,
  });
  if (outcome.void) {
    return { ...untouched, status: "VOIDED", voidedAt: input.now ?? new Date(), voidReason: "refund" };
  }
  return { ...untouched, amount: new Prisma.Decimal(outcome.amount), voidReason: "partial refund" };
}
