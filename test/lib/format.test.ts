import { describe, it, expect } from "vitest";
import { currencySymbol, formatCount, formatMoney } from "@/lib/format";
import { formatDate, initials, money, moneyHint, termsLine } from "@/lib/format";

describe("money", () => {
  it("prints an empty total as a bare 0, or as a zero in the fallback currency", () => {
    expect(money([])).toBe("0");
    expect(money([], "usd")).toBe("$0.00");
    expect(money([{ currency: "eur", total: "5.00" }], "usd")).toBe("€5.00");
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

describe("formatDate", () => {
  const now = new Date("2026-10-24T12:00:00Z");

  it("drops the year for this year and keeps it for any other", () => {
    expect(formatDate(new Date("2026-03-01T00:00:00Z"), now)).toBe("1 Mar");
    expect(formatDate(new Date("2025-12-31T00:00:00Z"), now)).toBe("31 Dec 2025");
  });
});

describe("initials", () => {
  it("takes the first letter of the first two words, or two letters of one", () => {
    expect(initials("Instant Gradient")).toBe("IG");
    expect(initials("Mockit")).toBe("MO");
    expect(initials("  ")).toBe("?");
  });
});

describe("termsLine", () => {
  const base = { durationMonths: null, attributionWindowDays: 60, holdingPeriodDays: 30 };

  it("states rate and duration, cookie window and hold", () => {
    expect(termsLine({ ...base, rate: 30, durationType: "FIXED_MONTHS", durationMonths: 12 })).toBe(
      "30% for 12 months · 60-day cookie · 30-day hold"
    );
    expect(termsLine({ ...base, rate: 12.5, durationType: "FOREVER" })).toBe("12.5% of every payment · 60-day cookie · 30-day hold");
    expect(termsLine({ ...base, rate: 25, durationType: "ONE_TIME" })).toBe(
      "25% of the first payment · 60-day cookie · 30-day hold"
    );
  });
});
