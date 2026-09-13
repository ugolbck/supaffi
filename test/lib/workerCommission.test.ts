import { describe, it, expect } from "vitest";
import { computeCommissionAmount, saleAmountFor } from "@/lib/worker/commission";

describe("computeCommissionAmount", () => {
  it("rounds a half cent up, where float arithmetic lands just under it", () => {
    // 50% of 2.01 is 1.005 exactly, which floats hold as 1.00499999...
    expect(computeCommissionAmount(201, "usd", 50).toFixed(2)).toBe("1.01");
  });

  it("works in major units for zero-decimal currencies", () => {
    expect(computeCommissionAmount(4900, "jpy", 15).toFixed(2)).toBe("735.00");
  });
});

describe("saleAmountFor", () => {
  it("converts minor units to major", () => {
    expect(saleAmountFor(4900, "usd")).toBe(49);
    expect(saleAmountFor(4999, "eur")).toBe(49.99);
  });

  it("leaves zero-decimal currencies alone", () => {
    expect(saleAmountFor(4900, "jpy")).toBe(4900);
  });
});
