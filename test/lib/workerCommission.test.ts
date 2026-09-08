import { describe, it, expect } from "vitest";
import { saleAmountFor } from "@/lib/worker/commission";

describe("saleAmountFor", () => {
  it("converts minor units to major", () => {
    expect(saleAmountFor(4900, "usd")).toBe(49);
    expect(saleAmountFor(4999, "eur")).toBe(49.99);
  });

  it("leaves zero-decimal currencies alone", () => {
    expect(saleAmountFor(4900, "jpy")).toBe(4900);
  });
});
