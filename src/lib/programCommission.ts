import type { CommissionDurationType } from "@prisma/client";

/**
 * The rate and its duration, read as one line a human would say out loud,
 * rather than as fields the Owner has to reconcile themselves.
 *
 * `commissionDurationMonths` is nullable in the schema even when the type is
 * FIXED_MONTHS: the current form always sets it together, but the database
 * does not enforce that pairing. A migration, a seed script, or a later form
 * change could produce a FIXED_MONTHS Program with no month count, so this
 * guards the combination instead of trusting the form to have run first. The
 * fallback says what is actually known (a fixed term exists) rather than
 * inventing a number of months.
 */
export function commissionLine(
  rate: number,
  type: CommissionDurationType,
  months: number | null
): string {
  if (type === "FOREVER") return `${rate}% forever`;
  if (type === "FIXED_MONTHS") {
    return months === null
      ? `${rate}% for a fixed term`
      : `${rate}% for ${months} month${months === 1 ? "" : "s"}`;
  }
  return `${rate}% one time`;
}
