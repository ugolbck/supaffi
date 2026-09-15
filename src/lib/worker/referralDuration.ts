import { Prisma } from "@prisma/client";
import type { Program } from "@prisma/client";
import { db } from "@/lib/db";
import { isPaymentWithinCommissionDuration, type PaymentRef } from "./commission";

/**
 * What a referral already did before the payment being judged.
 *
 * One click is one referral. Every subscription and one-time purchase that
 * came through it shares a single duration, so a customer who cancels and
 * subscribes again, or moves to another plan with a new Checkout, carries on
 * from where the referral already was instead of starting the program over.
 */
export type ReferralHistory = {
  /**
   * When the referral first brought money: the earliest first payment of any
   * of its subscriptions, or its earliest commission when that came first, as
   * a one-time purchase does. Null before either exists.
   */
  start: PaymentRef | null;
  /**
   * Whether a commission already exists on another payment of the referral,
   * whatever became of it since. A refunded, disputed, flagged or voided one
   * still used the referral's one-time commission.
   */
  earnedOnAnotherPayment: boolean;
};

/**
 * Whether a payment earns under the program's duration, given the referral's
 * history.
 *
 * A one-time program needs both checks. Stripe does not guarantee delivery
 * order, so a later subscription's first payment can earn before an earlier
 * one arrives and becomes the start; the existing commission is what stops the
 * earlier one earning too. And a payment that is not the start never earns, so
 * a first sale whose event failed and is retried still wins over a second
 * subscription processed in between. An out-of-order first payment can also
 * pay one commission outside a FIXED_MONTHS window, because the start moves
 * earlier once that commission was already written; this is accepted and
 * bounded to one commission.
 */
export function isWithinReferralDuration(program: Program, history: ReferralHistory, payment: PaymentRef): boolean {
  if (program.commissionDurationType === "FOREVER") return true;
  if (program.commissionDurationType === "ONE_TIME" && history.earnedOnAnotherPayment) return false;
  // Nothing on the referral yet, so this payment is its first.
  if (!history.start) return true;
  return isPaymentWithinCommissionDuration(program, history.start, payment);
}

type HistoryRow = { startRef: string | null; startAt: Date | null; earnedOnAnotherPayment: boolean };

/**
 * Reads a click's history in one statement.
 *
 * Subscriptions count once they claimed a first payment, cancelled or not:
 * a cancelled subscription is exactly what a resubscribe must not escape. Rows
 * another product holds for the click are left out. Commissions count whatever
 * their status, since a paid, voided or held row all mean the referral earned;
 * refund adjustments are left out because they belong to the row they adjust.
 * A one-time purchase keeps no date of its own, so its commission's creation
 * time stands in for it.
 */
export async function readReferralHistory(
  merchantId: string,
  clickId: string,
  paymentRef: string,
  /**
   * A one-time sale with a post-purchase invoice can be found under either its
   * invoice id or its PaymentIntent id (see chargeRefunded.ts). Passed here so
   * that if this same sale's row is ever read back under its other reference,
   * it still counts as the payment's own rather than as another payment on the
   * referral. `paymentRef` alone already covers every ordinary case; this only
   * matters for that one sale shape. Defensive: the checkout handler already
   * returns earlier whenever a row exists under the sale's other reference, so
   * in practice this never excludes anything by the time this runs.
   */
  ownOtherRefs: readonly string[] = []
): Promise<ReferralHistory> {
  const ownRefs = [paymentRef, ...ownOtherRefs];
  const rows = await db.$queryRaw<HistoryRow[]>`
    WITH payments AS (
      SELECT "firstPaymentRef" AS ref, "firstPaidAt" AS at, 'subscription' AS source
      FROM "ReferredSubscription"
      WHERE "clickId" = ${clickId}
        AND "merchantId" = ${merchantId}
        AND "firstPaymentRef" IS NOT NULL
        AND "firstPaidAt" IS NOT NULL
      UNION ALL
      SELECT "Commission"."stripePaymentRef" AS ref, "Commission"."createdAt" AS at, 'commission' AS source
      FROM "Commission"
      JOIN "Affiliate" a ON a.id = "Commission"."affiliateId" AND a."merchantId" = ${merchantId}
      WHERE "Commission"."clickId" = ${clickId}
        AND "Commission"."adjustsCommissionId" IS NULL
        AND "Commission"."stripePaymentRef" IS NOT NULL
    )
    SELECT
      (SELECT ref FROM payments ORDER BY at ASC, ref ASC LIMIT 1) AS "startRef",
      (SELECT at FROM payments ORDER BY at ASC, ref ASC LIMIT 1) AS "startAt",
      EXISTS (
        SELECT 1 FROM payments WHERE source = 'commission' AND ref NOT IN (${Prisma.join(ownRefs)})
      ) AS "earnedOnAnotherPayment"
  `;
  const row = rows[0];
  return {
    start: row?.startRef && row.startAt ? { ref: row.startRef, at: row.startAt } : null,
    earnedOnAnotherPayment: row?.earnedOnAnotherPayment === true,
  };
}

/**
 * Whether a payment on this click earns under the program's duration. One
 * indexed read per sale, and none on a forever program, which has no duration
 * to measure.
 *
 * Call it after the payment's subscription claimed its first payment, so a
 * referral's very first sale is measured against itself. The worker handles
 * events one at a time (tick.ts), so two sales on one click are never judged at
 * the same moment.
 */
export async function referralStillEarns(
  merchantId: string,
  clickId: string,
  program: Program,
  payment: PaymentRef,
  /** The sale's other reference, when it has one (see readReferralHistory). */
  ownOtherRefs: readonly string[] = []
): Promise<boolean> {
  if (program.commissionDurationType === "FOREVER") return true;
  const history = await readReferralHistory(merchantId, clickId, payment.ref, ownOtherRefs);
  return isWithinReferralDuration(program, history, payment);
}
