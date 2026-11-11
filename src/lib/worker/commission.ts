import { Prisma } from "@prisma/client";
import type { Affiliate, Program } from "@prisma/client";
import { minorUnitsToMajor } from "@/lib/money";

export function commissionRateFor(affiliate: Affiliate, program: Program): number {
  return Number(affiliate.customCommissionRate ?? program.defaultCommissionRate);
}

// Decimal rather than float arithmetic: an exact half cent is often held as
// a hair under it in binary floating point, so float rounding took it down
// where the ledger should round it up.
export function computeCommissionAmount(
  paidAmountMinor: number,
  currency: string,
  ratePercent: number
): Prisma.Decimal {
  return new Prisma.Decimal(minorUnitsToMajor(paidAmountMinor, currency))
    .mul(ratePercent)
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** The customer's payment in major units, for the revenue the commission was earned on. */
export function saleAmountFor(paidAmountMinor: number, currency: string): number {
  return minorUnitsToMajor(paidAmountMinor, currency);
}

export function computePayableAt(program: Program, from: Date = new Date()): Date {
  return new Date(from.getTime() + program.holdingPeriodDays * 24 * 60 * 60 * 1000);
}

/** A payment Supaffi can recognise again: the provider's id for it and when it was charged. */
export type PaymentRef = { ref: string; at: Date };

/**
 * The same day and time a number of calendar months later, in UTC, stopping at
 * the last day of a shorter month. Date.setMonth rolls January 31 plus one
 * month over to March 3, which quietly stretched a fixed-months program.
 */
export function addMonthsClamped(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(from.getUTCDate(), lastDayOfTargetMonth),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds()
    )
  );
}

// A renewal lands on the anniversary of the first payment, give or take the
// minutes between a Checkout Session opening and Stripe creating the invoice.
// Without slack, the renewal that opens month N+1 could fall a moment inside
// the window and pay one month too many. A day is far shorter than any billing
// interval a fixed-months program is used with.
const DURATION_BOUNDARY_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a payment still earns, measured from the referral's first payment,
 * not from when the click happened. A click can come weeks before the
 * purchase, and a free trial delays the first payment further. Callers pass the
 * first payment of the whole referral (referralDuration.ts), so a second
 * subscription on the same click does not start the duration over.
 */
export function isPaymentWithinCommissionDuration(
  program: Program,
  firstPayment: PaymentRef,
  payment: PaymentRef
): boolean {
  if (payment.ref === firstPayment.ref) return true;
  switch (program.commissionDurationType) {
    case "FOREVER":
      return true;
    case "ONE_TIME":
      return false;
    case "FIXED_MONTHS": {
      const end = addMonthsClamped(firstPayment.at, program.commissionDurationMonths ?? 0);
      return payment.at.getTime() < end.getTime() - DURATION_BOUNDARY_GRACE_MS;
    }
  }
}
