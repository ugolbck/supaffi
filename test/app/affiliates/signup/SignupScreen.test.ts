import { describe, it, expect } from "vitest";
import { durationTerm, formatRate } from "@/app/affiliates/signup/[program]/SignupScreen";

describe("durationTerm", () => {
  it("reads as an ongoing payment for FOREVER", () => {
    expect(
      durationTerm({ rate: 20, durationType: "FOREVER", durationMonths: null })
    ).toEqual({ value: "Every payment", hint: "as long as the customer pays" });
  });

  it("counts the months for FIXED_MONTHS", () => {
    expect(
      durationTerm({ rate: 20, durationType: "FIXED_MONTHS", durationMonths: 6 })
    ).toEqual({ value: "6 months", hint: "of everything the customer pays" });
  });

  it("never falls through to one-time wording for FIXED_MONTHS, even without a month count", () => {
    const result = durationTerm({
      rate: 20,
      durationType: "FIXED_MONTHS",
      durationMonths: null,
    });
    expect(result.value).not.toBe("First payment");
    expect(result.hint).toBe("of everything the customer pays");
  });

  it("reads as a single payment for ONE_TIME", () => {
    expect(
      durationTerm({ rate: 20, durationType: "ONE_TIME", durationMonths: null })
    ).toEqual({ value: "First payment", hint: "one commission per customer" });
  });
});

describe("formatRate", () => {
  it("drops trailing zeros", () => {
    expect(formatRate(20)).toBe("20%");
    expect(formatRate(12.5)).toBe("12.5%");
  });
});
