import { Prisma } from "@prisma/client";
import type { CommissionStatus } from "@prisma/client";
import type Stripe from "stripe";
import { prorateCommission } from "./handlers/chargeRefunded";
import { disputeStateFor, type DisputeState } from "./disputes";

export type ChargeSnapshot = { amount: number; amountRefunded: number; disputed: boolean };

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
    console.warn(
      `[worker] could not check invoice ${invoiceId} for an earlier refund: ${(err as Error).message}. The refund check was skipped; replacing the Stripe key in settings lets Supaffi read charges.`
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
 * as a permission error or as an invalid request. So every failure, of any
 * type, answers null: the commission is then created exactly as it was
 * before this lookup existed.
 */
export async function latestChargeFor(stripe: Stripe, paymentIntentId: string): Promise<ChargeSnapshot | null> {
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
    const charge = intent.latest_charge;
    if (!charge || typeof charge === "string") return null;
    return { amount: charge.amount, amountRefunded: charge.amount_refunded, disputed: charge.disputed === true };
  } catch (err) {
    console.warn(
      `[worker] could not read the charge behind payment ${paymentIntentId}: ${(err as Error).message}. The refund check was skipped; replacing the Stripe key in settings lets Supaffi read charges.`
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

export type CreationFields = {
  amount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
  status: CommissionStatus;
  voidedAt: Date | null;
  voidReason: string | null;
  disputeOpenedAt: Date | null;
};

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
 *
 * A dispute can arrive early in the same way, and is read back here too. One
 * still open, or one that could not be read, holds the new row from the start;
 * one already lost voids it as a chargeback, unless a full refund already
 * voided it, which stays the recorded cause. A dispute closed in the
 * merchant's favour changes nothing.
 */
export function commissionFieldsAtCreation(input: {
  amount: Prisma.Decimal;
  flagReason: string | null;
  charge: ChargeSnapshot | null;
  /** What Stripe says about disputes on the charge. Null or absent when not checked. */
  dispute?: DisputeState | null;
  /** The referred share of the charge, in minor units, when the row records one. */
  referredChargeMinor?: number | null;
  now?: Date;
}): CreationFields {
  const now = input.now ?? new Date();
  const held = input.dispute === "open" || input.dispute === "unknown";
  let fields: CreationFields = {
    amount: input.amount,
    grossAmount: input.amount,
    status: input.flagReason ? "FLAGGED" : "PENDING",
    voidedAt: null,
    voidReason: null,
    disputeOpenedAt: held ? now : null,
  };

  if (input.charge && input.charge.amountRefunded > 0) {
    const outcome = prorateCommission({
      gross: input.amount,
      chargeTotal: input.charge.amount,
      refunded: input.charge.amountRefunded,
      referredChargeMinor: input.referredChargeMinor,
    });
    if (outcome.void) {
      return { ...fields, status: "VOIDED", voidedAt: now, voidReason: "refund", disputeOpenedAt: null };
    }
    fields = { ...fields, amount: new Prisma.Decimal(outcome.amount), voidReason: "partial refund" };
  }

  if (input.dispute === "lost") {
    return { ...fields, status: "VOIDED", voidedAt: now, voidReason: "chargeback", disputeOpenedAt: null };
  }
  return fields;
}
