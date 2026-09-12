import { describe, it, expect } from "vitest";
import { validateProgramInput } from "@/lib/programValidation";

const validInput = {
  name: "Standard",
  defaultCommissionRate: "20",
  commissionDurationType: "FOREVER",
  commissionDurationMonths: "",
  attributionWindowDays: "60",
  holdingPeriodDays: "30",
};

describe("validateProgramInput", () => {
  it("accepts valid FOREVER input", () => {
    expect(validateProgramInput(validInput)).toEqual({ error: null, parsed: expect.any(Object) });
  });

  it("rejects a missing name", () => {
    expect(validateProgramInput({ ...validInput, name: "  " }).error).toBe("Name is required");
  });

  it("rejects a commission rate of 0", () => {
    expect(validateProgramInput({ ...validInput, defaultCommissionRate: "0" }).error).toBe(
      "Commission rate must be greater than 0 and no more than 100"
    );
  });

  it("rejects a commission rate over 100", () => {
    expect(validateProgramInput({ ...validInput, defaultCommissionRate: "150" }).error).toBe(
      "Commission rate must be greater than 0 and no more than 100"
    );
  });

  it("requires commissionDurationMonths when type is FIXED_MONTHS", () => {
    expect(
      validateProgramInput({
        ...validInput,
        commissionDurationType: "FIXED_MONTHS",
        commissionDurationMonths: "",
      }).error
    ).toBe("Enter how many months the commission is paid for");
  });

  it("accepts FIXED_MONTHS with a positive commissionDurationMonths", () => {
    const result = validateProgramInput({
      ...validInput,
      commissionDurationType: "FIXED_MONTHS",
      commissionDurationMonths: "12",
    });
    expect(result.error).toBeNull();
    expect(result.parsed?.commissionDurationMonths).toBe(12);
  });

  it("rejects a non-positive attributionWindowDays", () => {
    expect(validateProgramInput({ ...validInput, attributionWindowDays: "0" }).error).toBe(
      "Time to buy must be a whole number of days, at least 1"
    );
  });

  it("rejects a non-positive holdingPeriodDays", () => {
    expect(validateProgramInput({ ...validInput, holdingPeriodDays: "-1" }).error).toBe(
      "Hold before paying must be a whole number of days, at least 1"
    );
  });
});
