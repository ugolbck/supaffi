import { describe, it, expect } from "vitest";
import { currencySymbol, formatCount, formatMoney } from "@/lib/format";
import { money, moneyHint } from "@/lib/format";

describe("money", () => {
  it("returns a zeroed placeholder for an empty total", () => {
    expect(money([])).toBe("0.00");
  });

  it("formats a single currency total", () => {
    expect(money([{ currency: "usd", total: "240.00" }])).toBe("$240.00");
  });

  it("uses only the first currency, ignoring the rest", () => {
    expect(
      money([
        { currency: "eur", total: "10.00" },
        { currency: "usd", total: "240.00" },
      ])
    ).toBe("€10.00");
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
    ).toBe("$240.00  ·  £5.00");
  });
});

describe("formatMoney", () => {
  it("prints the currency's own symbol with grouping and two decimals", () => {
    expect(formatMoney(1220, "usd")).toBe("$1,220.00");
    expect(formatMoney("60.5", "eur")).toBe("€60.50");
    expect(formatMoney(-5.7, "gbp")).toBe("-£5.70");
    expect(formatMoney(8000, "inr")).toBe("₹8,000.00");
  });
  it("prints the code for a currency with no symbol", () => {
    // Intl sets the code off with a non-breaking space.
    expect(formatMoney(12, "zzz")).toBe("ZZZ\u00a012.00");
  });
  it("gives the symbol alone for an axis", () => {
    expect(currencySymbol("usd")).toBe("$");
    expect(currencySymbol("chf")).toBe("CHF");
  });
  it("groups counts", () => {
    expect(formatCount(31143)).toBe("31,143");
  });
});
