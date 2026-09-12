import { describe, it, expect } from "vitest";
import { bucketKey, currenciesByUse, isChartRange, pickCurrency, rangeLabel, resolveRange } from "@/lib/analytics";

// Pure, no database: the windows the range picker offers, in UTC.
const NOW = new Date("2026-09-12T14:35:00Z"); // a Saturday
const STARTED = new Date("2025-03-20T09:00:00Z");

describe("resolveRange", () => {
  it("cuts a single day into hours and stops at now", () => {
    const w = resolveRange("today", NOW, STARTED);
    expect(w.bucket).toBe("hour");
    expect(w.since.toISOString()).toBe("2026-09-12T00:00:00.000Z");
    expect(w.until).toEqual(NOW);
  });

  it("yesterday is the whole of the previous day", () => {
    const w = resolveRange("yesterday", NOW, STARTED);
    expect(w.bucket).toBe("hour");
    expect(w.since.toISOString()).toBe("2026-09-11T00:00:00.000Z");
    expect(w.until.toISOString()).toBe("2026-09-11T23:59:59.999Z");
  });

  it("this week starts on Monday", () => {
    const w = resolveRange("this-week", NOW, STARTED);
    expect(w.bucket).toBe("day");
    expect(w.since.toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("seven and thirty days include today", () => {
    expect(resolveRange("7d", NOW, STARTED).since.toISOString()).toBe("2026-09-06T00:00:00.000Z");
    expect(resolveRange("30d", NOW, STARTED).since.toISOString()).toBe("2026-08-14T00:00:00.000Z");
  });

  it("twelve months are months, from the first of the month eleven back", () => {
    const w = resolveRange("12m", NOW, STARTED);
    expect(w.bucket).toBe("month");
    expect(w.since.toISOString()).toBe("2025-10-01T00:00:00.000Z");
  });

  it("all time is months once there is more than two months of history", () => {
    const w = resolveRange("all", NOW, STARTED);
    expect(w.bucket).toBe("month");
    expect(w.since.toISOString()).toBe("2025-03-01T00:00:00.000Z");
  });

  it("all time on a young product is still days", () => {
    const w = resolveRange("all", NOW, new Date("2026-08-01T10:00:00Z"));
    expect(w.bucket).toBe("day");
    expect(w.since.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("a plain number of days keeps the old shape", () => {
    const w = resolveRange(7, NOW, STARTED);
    expect(w.bucket).toBe("day");
    expect(w.since.toISOString()).toBe("2026-09-06T00:00:00.000Z");
  });
});

describe("bucketKey", () => {
  const at = new Date("2026-09-12T14:35:21Z");
  it("names the hour, the day or the month a moment falls in", () => {
    expect(bucketKey(at, "hour")).toBe("2026-09-12T14:00:00.000Z");
    expect(bucketKey(at, "day")).toBe("2026-09-12");
    expect(bucketKey(at, "month")).toBe("2026-09-01");
  });
});

describe("range names", () => {
  it("accepts only the ranges on offer", () => {
    expect(isChartRange("30d")).toBe(true);
    expect(isChartRange("last-year")).toBe(false);
    expect(isChartRange(undefined)).toBe(false);
  });
  it("labels them for a header", () => {
    expect(rangeLabel("this-month")).toBe("This month");
  });
});

describe("currency choice", () => {
  const day = (amounts: Record<string, { gross: number; commission: number; sales: number }>) => ({
    date: "2026-09-01",
    clicks: 0,
    conversions: 0,
    revenue: 0,
    signups: 0,
    amounts,
  });

  it("ranks by how many sales, never by the total", () => {
    // The trap: one sale of 8,000 rupees outranks fifty of 100 dollars on
    // any sum, and the chart would open on the currency this merchant
    // barely trades in, with every dollar day a stub beside it.
    const series = [
      day({
        inr: { gross: 8000, commission: 1600, sales: 1 },
        usd: { gross: 5000, commission: 1000, sales: 50 },
      }),
    ];
    expect(currenciesByUse(series)).toEqual(["usd", "inr"]);
  });

  it("gives nothing when nothing has sold", () => {
    expect(currenciesByUse([day({})])).toEqual([]);
    expect(pickCurrency([], "usd")).toBeNull();
  });

  it("opens on the most used, and honours a currency that is really there", () => {
    expect(pickCurrency(["usd", "eur"], undefined)).toBe("usd");
    expect(pickCurrency(["usd", "eur"], "eur")).toBe("eur");
    expect(pickCurrency(["usd", "eur"], "gbp")).toBe("usd");
  });
});
