import { Prisma } from "@prisma/client";
import type { CommissionStatus } from "@prisma/client";
import { prorateCommission } from "./reversal";
import type { DisputeState } from "./disputes";

export type ChargeSnapshot = { amount: number; amountRefunded: number; disputed: boolean };

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
