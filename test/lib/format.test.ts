import { describe, it, expect } from "vitest";
import { money, moneyHint } from "@/lib/format";

describe("money", () => {
  it("returns a zeroed placeholder for an empty total", () => {
    expect(money([])).toBe("0.00");
  });

  it("formats a single currency total", () => {
    expect(money([{ currency: "usd", total: "240.00" }])).toBe("240.00 USD");
  });

  it("uses only the first currency, ignoring the rest", () => {
    expect(
      money([
        { currency: "eur", total: "10.00" },
        { currency: "usd", total: "240.00" },
      ])
    ).toBe("10.00 EUR");
  });
});

describe("moneyHint", () => {
  it("returns undefined for an empty total", () => {
    expect(moneyHint([])).toBeUndefined();
  });

  it("returns undefined for a single currency, since there is nothing left to hint at", () => {
    expect(moneyHint([{ currency: "usd", total: "240.00" }])).toBeUndefined();
  });

  it("joins every currency after the first for two or more", () => {
    expect(
      moneyHint([
        { currency: "eur", total: "10.00" },
        { currency: "usd", total: "240.00" },
        { currency: "gbp", total: "5.00" },
      ])
    ).toBe("240.00 USD  ·  5.00 GBP");
  });
});
