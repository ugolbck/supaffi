import type { ProgramInput } from "@/lib/program";

/** The discount select's "None": a Select item needs a value, and "" is none. */
export const NO_DISCOUNT = "none";

export type ProgramFormValues = {
  name: string;
  defaultCommissionRate: string;
  commissionDurationType: string;
  commissionDurationMonths: string;
  attributionWindowDays: string;
  holdingPeriodDays: string;
  /** Left out by onboarding, which has no such field. Empty means no minimum. */
  minimumPayout?: string;
};

export function validateProgramInput(
  input: ProgramFormValues
): { error: string; parsed?: undefined } | { error: null; parsed: ProgramInput } {
  if (!input.name.trim()) return { error: "Name is required" };

  const rate = Number(input.defaultCommissionRate);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
    return { error: "Commission rate must be greater than 0 and no more than 100" };
  }

  const durationType = input.commissionDurationType;
  if (durationType !== "ONE_TIME" && durationType !== "FIXED_MONTHS" && durationType !== "FOREVER") {
    return { error: "Invalid commission duration type" };
  }

  let commissionDurationMonths: number | null = null;
  if (durationType === "FIXED_MONTHS") {
    const months = Number(input.commissionDurationMonths);
    if (!Number.isFinite(months) || months <= 0 || !Number.isInteger(months)) {
      return { error: "Enter how many months the commission is paid for" };
    }
    commissionDurationMonths = months;
  }

  const attributionWindowDays = Number(input.attributionWindowDays);
  if (!Number.isFinite(attributionWindowDays) || attributionWindowDays <= 0 || !Number.isInteger(attributionWindowDays)) {
    return { error: "Time to buy must be a whole number of days, at least 1" };
  }

  const holdingPeriodDays = Number(input.holdingPeriodDays);
  if (!Number.isFinite(holdingPeriodDays) || holdingPeriodDays <= 0 || !Number.isInteger(holdingPeriodDays)) {
    return { error: "Hold before paying must be a whole number of days, at least 1" };
  }

  let minimumPayout: string | null | undefined;
  if (input.minimumPayout !== undefined) {
    const raw = input.minimumPayout.trim();
    const value = Number(raw);
    if (raw && (!/^\d+(\.\d{1,2})?$/.test(raw) || !Number.isFinite(value) || value >= 1e16)) {
      return { error: "Minimum payout must be an amount like 50 or 50.00" };
    }
    minimumPayout = raw && value > 0 ? value.toFixed(2) : null;
  }

  return {
    error: null,
    parsed: {
      name: input.name.trim(),
      defaultCommissionRate: rate,
      commissionDurationType: durationType,
      commissionDurationMonths,
      attributionWindowDays,
      holdingPeriodDays,
      ...(minimumPayout !== undefined && { minimumPayout }),
    },
  };
}
