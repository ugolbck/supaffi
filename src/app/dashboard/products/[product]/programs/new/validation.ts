import type { ProgramInput } from "@/lib/program";

export type ProgramFormValues = {
  name: string;
  defaultCommissionRate: string;
  commissionDurationType: string;
  commissionDurationMonths: string;
  attributionWindowDays: string;
  holdingPeriodDays: string;
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
      return { error: "Enter the number of months for a fixed-duration Program" };
    }
    commissionDurationMonths = months;
  }

  const attributionWindowDays = Number(input.attributionWindowDays);
  if (!Number.isFinite(attributionWindowDays) || attributionWindowDays <= 0 || !Number.isInteger(attributionWindowDays)) {
    return { error: "Attribution window must be a positive number of days" };
  }

  const holdingPeriodDays = Number(input.holdingPeriodDays);
  if (!Number.isFinite(holdingPeriodDays) || holdingPeriodDays <= 0 || !Number.isInteger(holdingPeriodDays)) {
    return { error: "Holding period must be a positive number of days" };
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
    },
  };
}
