import { describe, it, expect } from "vitest";
import { recurringTerm, formatRate } from "@/app/affiliates/signup/[program]/SignupScreen";

describe("recurringTerm", () => {
  it("reads as an ongoing payment for FOREVER", () => {
    expect(
      recurringTerm({ rate: 20, durationType: "FOREVER", durationMonths: null })
    ).toEqual({ value: "Every payment", hint: "for as long as they stay" });
  });

  it("counts the months for FIXED_MONTHS", () => {
    expect(
      recurringTerm({ rate: 20, durationType: "FIXED_MONTHS", durationMonths: 6 })
    ).toEqual({ value: "6 months", hint: "of everything they pay" });
  });

  it("never falls through to one-time wording for FIXED_MONTHS, even without a month count", () => {
    const result = recurringTerm({
      rate: 20,
      durationType: "FIXED_MONTHS",
      durationMonths: null,
    });
    expect(result.value).not.toBe("First payment");
    expect(result.hint).toBe("of everything they pay");
  });

  it("reads as a single payment for ONE_TIME", () => {
    expect(
      recurringTerm({ rate: 20, durationType: "ONE_TIME", durationMonths: null })
    ).toEqual({ value: "First payment", hint: "one commission per customer" });
  });
});

describe("formatRate", () => {
  it("drops trailing zeros", () => {
    expect(formatRate(20)).toBe("20%");
    expect(formatRate(12.5)).toBe("12.5%");
  });
});
