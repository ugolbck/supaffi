// Destructive: clears Commission / Click / Affiliate / Program / Merchant /
// Owner before each test. Runs against the scratch DATABASE_URL.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  getProductMetrics,
  getTopAffiliates,
  getPayableGroups,
  getOwedTotals,
  toWeeks,
  change,
  earnedTrend,
  type DayPoint,
} from "@/lib/analytics";

const hasDatabase = Boolean(process.env.DATABASE_URL);

async function clearAll() {
  await db.commission.deleteMany();
  await db.referredSubscription.deleteMany();
  await db.click.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

afterAll(async () => {
  await clearAll();
  await db.$disconnect();
});

function daysAgo(n: number): Date {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - n);
  return date;
}

describe.skipIf(!hasDatabase)("analytics", () => {
  let ownerId: string;
  let otherOwnerId: string;
  let merchantId: string;
  let emptyMerchantId: string;
  let programId: string;

  beforeEach(async () => {
    await clearAll();

    const owner = await db.owner.create({
      data: { email: `analytics-${crypto.randomUUID()}@example.com`, passwordHash: "x" },
    });
    ownerId = owner.id;
    const other = await db.owner.create({
      data: { email: `other-${crypto.randomUUID()}@example.com`, passwordHash: "x" },
    });
    otherOwnerId = other.id;

    const merchant = await db.merchant.create({
      data: {
        ownerId,
        slug: "main",
        name: "Main",
        domain: `${crypto.randomUUID()}.example.com`,
        websiteUrl: "https://example.com",
      },
    });
    merchantId = merchant.id;
    const empty = await db.merchant.create({
      data: {
        ownerId,
        slug: "empty",
        name: "Empty",
        domain: `${crypto.randomUUID()}.example.com`,
        websiteUrl: "https://example.com",
      },
    });
    emptyMerchantId = empty.id;

    const program = await db.program.create({
      data: {
        merchantId,
        slug: "standard",
        name: "Standard",
        defaultCommissionRate: "20.00",
        commissionDurationType: "FOREVER",
        attributionWindowDays: 60,
        holdingPeriodDays: 30,
      },
    });
    programId = program.id;
  });

  async function makeAffiliate(suffix: string) {
    return db.affiliate.create({
      data: {
        merchantId,
        programId,
        email: `aff-${suffix}@example.com`,
        name: `Aff ${suffix}`,
        links: {
          create: { code: `code-${suffix}-${crypto.randomUUID().slice(0, 8)}`, isPrimary: true },
        },
      },
    });
  }

  async function makeClick(affiliateId: string, createdAt = new Date()) {
    return db.click.create({
      data: {
        affiliateId,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60 * 86400_000),
        createdAt,
      },
    });
  }

  async function makeCommission(
    affiliateId: string,
    clickId: string,
    overrides: Partial<{
      amount: string;
      currency: string;
      status: "PENDING" | "PAYABLE" | "PAID" | "VOIDED" | "FLAGGED";
      createdAt: Date;
      adjustsCommissionId: string;
    }> = {}
  ) {
    return db.commission.create({
      data: {
        affiliateId,
        clickId,
        amount: overrides.amount ?? "10.00",
        currency: overrides.currency ?? "usd",
        status: overrides.status ?? "PAYABLE",
        payableAt: new Date(Date.now() - 1000),
        createdAt: overrides.createdAt ?? new Date(),
        adjustsCommissionId: overrides.adjustsCommissionId ?? null,
      },
    });
  }

  it("leaves the owner's revenue, commission cost and sales untouched by a clawback", async () => {
    // Revenue is what customers paid. A refund after payout is a debt the
    // affiliate carries, not a sale, so it stays out of the Owner's figures.
    const affiliate = await makeAffiliate("a");
    const click = await makeClick(affiliate.id);
    const sale = await db.commission.create({
      data: {
        affiliateId: affiliate.id,
        clickId: click.id,
        amount: "30.00",
        saleAmount: "100.00",
        currency: "usd",
        status: "PAID",
        payableAt: daysAgo(3),
        createdAt: daysAgo(3),
      },
    });
    await makeCommission(affiliate.id, click.id, {
      amount: "-10.00",
      createdAt: daysAgo(1),
      adjustsCommissionId: sale.id,
    });

    const metrics = await getProductMetrics(ownerId, merchantId, 30);

    expect(metrics.conversions).toBe(1);
    expect(metrics.current.amounts.usd).toEqual({ gross: 100, commission: 30, sales: 1 });
  });

  it("zero-fills every day in the window, oldest first", async () => {
    // A chart drawn straight from grouped rows closes its own gaps, which
    // turns three quiet days into one steep line.
    const affiliate = await makeAffiliate("a");
    await makeClick(affiliate.id, daysAgo(3));

    const metrics = await getProductMetrics(ownerId, merchantId, 7);

    expect(metrics.series).toHaveLength(7);
    expect(metrics.series[0].date < metrics.series[6].date).toBe(true);
    expect(metrics.series.filter((d) => d.clicks > 0)).toHaveLength(1);
    expect(metrics.series.every((d) => typeof d.clicks === "number")).toBe(true);
  });

  it("ignores anything older than the window", async () => {
    const affiliate = await makeAffiliate("a");
    await makeClick(affiliate.id, daysAgo(40));

    const metrics = await getProductMetrics(ownerId, merchantId, 7);
    expect(metrics.clicks).toBe(0);
  });

  it("keeps owed money per currency and counts pending, payable and flagged", async () => {
    const affiliate = await makeAffiliate("a");
    const click = await makeClick(affiliate.id);
    await makeCommission(affiliate.id, click.id, { amount: "10.00", status: "PENDING" });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "15.50",
      status: "PAYABLE",
    });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "4.00",
      status: "FLAGGED",
    });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "9.00",
      currency: "eur",
      status: "PAYABLE",
    });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "99.00",
      status: "PAID",
    });

    const metrics = await getProductMetrics(ownerId, merchantId, 30);

    expect(metrics.owed).toEqual([
      { currency: "eur", total: "9.00" },
      { currency: "usd", total: "29.50" },
    ]);
    expect(metrics.paid).toEqual([{ currency: "usd", total: "99.00" }]);
    // The commissions page reads the same helper, so the two screens cannot drift.
    const { owed, payableNow } = await getOwedTotals(ownerId, merchantId);
    expect(owed).toEqual(metrics.owed);
    expect(payableNow).toEqual([
      { currency: "eur", total: "9.00" },
      { currency: "usd", total: "15.50" },
    ]);
  });

  it("reports a conversion rate of 0 rather than NaN when nothing was clicked", async () => {
    const metrics = await getProductMetrics(ownerId, emptyMerchantId, 30);
    expect(metrics.conversionRate).toBe(0);
    expect(metrics.clicks).toBe(0);
  });

  it("never leaks another owner's product", async () => {
    await expect(getProductMetrics(otherOwnerId, merchantId, 30)).rejects.toThrow();
    await expect(getPayableGroups(otherOwnerId, merchantId)).rejects.toThrow();
    await expect(getTopAffiliates(otherOwnerId, merchantId)).rejects.toThrow();
    await expect(getOwedTotals(otherOwnerId, merchantId)).rejects.toThrow();
  });

  it("ranks top affiliates by money earned, not by clicks", async () => {
    const busy = await makeAffiliate("busy");
    const earner = await makeAffiliate("earner");
    for (let i = 0; i < 5; i += 1) await makeClick(busy.id);
    await makeCommission(busy.id, (await makeClick(busy.id)).id, { amount: "1.00" });
    await makeCommission(earner.id, (await makeClick(earner.id)).id, { amount: "500.00" });

    const top = await getTopAffiliates(ownerId, merchantId, 5);

    expect(top[0].email).toBe("aff-earner@example.com");
    expect(top[1].email).toBe("aff-busy@example.com");
    expect(top[1].clicks).toBe(6);
  });

  it("counts sales per top affiliate without counting refund adjustments", async () => {
    // A refund writes a second, negative commission pointing at the one it
    // corrects. Counting rows would read one refunded sale as two sales.
    const affiliate = await makeAffiliate("a");
    const first = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "20.00",
    });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { amount: "30.00" });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "-20.00",
      adjustsCommissionId: first.id,
    });

    const top = await getTopAffiliates(ownerId, merchantId, 5);

    expect(top).toHaveLength(1);
    expect(top[0].sales).toBe(2);
    expect(top[0].earned).toEqual([{ currency: "usd", total: "30.00" }]);
  });

  it("returns payable groups carrying the exact commission ids behind each total", async () => {
    const affiliate = await makeAffiliate("a");
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { amount: "10.00" });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { amount: "15.50" });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "99.00",
      status: "PENDING",
    });

    const groups = await getPayableGroups(ownerId, merchantId);

    expect(groups).toHaveLength(1);
    expect(groups[0].total).toBe("25.50");
    expect(groups[0].commissionIds).toHaveLength(2);
    // The amounts each id was rendered at, which is what Mark paid binds.
    expect(groups[0].commissions.map((c) => c.amount).sort()).toEqual(["10.00", "15.50"]);
    expect(groups[0].commissions.map((c) => c.id).sort()).toEqual([...groups[0].commissionIds].sort());
  });

  it("never lets a negative PAYABLE row with no adjustment link into a group", async () => {
    // A stray negative row that is not (or is no longer) linked as an
    // adjustment must not block or shrink a group a payout button offers.
    const affiliate = await makeAffiliate("a");
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { amount: "10.00" });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { amount: "-5.00" });

    const groups = await getPayableGroups(ownerId, merchantId);

    expect(groups).toHaveLength(1);
    expect(groups[0].total).toBe("10.00");
    expect(groups[0].commissionIds).toHaveLength(1);
  });

  it("splits payable groups by currency, never summing across them", async () => {
    const affiliate = await makeAffiliate("a");
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { amount: "10.00" });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "10.00",
      currency: "eur",
    });

    const groups = await getPayableGroups(ownerId, merchantId);
    expect(groups.map((g) => g.currency).sort()).toEqual(["eur", "usd"]);
  });

  it("sums revenue by currency and counts signups in the window", async () => {
    const affiliate = await makeAffiliate("rev");
    const click = await makeClick(affiliate.id);
    const affiliateId = affiliate.id;
    const clickId = click.id;
    await db.commission.createMany({
      data: [
        { affiliateId, clickId, amount: 10, saleAmount: 50, currency: "usd", status: "PENDING", payableAt: new Date() },
        { affiliateId, clickId, amount: 8, saleAmount: 40, currency: "usd", status: "PAID", payableAt: new Date() },
        { affiliateId, clickId, amount: 9, saleAmount: 45, currency: "eur", status: "PENDING", payableAt: new Date() },
        // An adjustment carries no sale.
        { affiliateId, clickId, amount: -8, saleAmount: null, currency: "usd", status: "VOIDED", payableAt: new Date() },
      ],
    });
    await db.affiliate.create({
      data: { merchantId, programId, email: "second@example.com" },
    });

    const metrics = await getProductMetrics(ownerId, merchantId, 30);

    expect(metrics.revenue).toEqual([
      { currency: "eur", total: "45.00" },
      { currency: "usd", total: "90.00" },
    ]);
    expect(metrics.signups).toBe(2);
  });

  it("carries a signup on the day the affiliate joined", async () => {
    const joined = daysAgo(3);
    await db.affiliate.create({
      data: { merchantId, programId, email: "joined@example.com", createdAt: joined },
    });

    const metrics = await getProductMetrics(ownerId, merchantId, 7);

    const day = metrics.series.find((d) => d.date === joined.toISOString().slice(0, 10));
    expect(day?.signups).toBe(1);
    expect(metrics.series.reduce((sum, d) => sum + d.signups, 0)).toBe(1);
  });

});

// Pure function, no database: builds synthetic day series and checks the
// bucketing rules toWeeks documents rather than merely implements.
function daySeries(
  count: number,
  make: (i: number) => Partial<DayPoint> = () => ({})
): DayPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date("2026-01-01T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + i);
    return {
      date: date.toISOString().slice(0, 10),
      clicks: 0,
      conversions: 0,
      revenue: 0,
      signups: 0,
      amounts: {},
      ...make(i),
    };
  });
}

describe("toWeeks", () => {
  it("buckets exactly 84 days into 12 weeks of 7", () => {
    const daily = daySeries(84, () => ({ clicks: 1, conversions: 1 }));

    const weeks = toWeeks(daily);

    expect(weeks).toHaveLength(12);
    expect(weeks.every((w) => w.clicks === 7 && w.conversions === 7)).toBe(true);
    // Oldest first, one bucket date per 7-day chunk.
    expect(weeks[0].date).toBe(daily[0].date);
    expect(weeks[11].date).toBe(daily[77].date);
  });

  it("keeps a leftover partial week as its own smaller bucket, neither dropped nor merged", () => {
    // 10 days: one full week plus 3 leftover days. Folding the leftover into
    // the prior week would inflate that week's total; dropping it would
    // under-report the most recent days, the ones a chart's rightmost bar
    // exists to show. So it gets counted, on its own, exactly as many days
    // as actually happened.
    const daily = daySeries(10, () => ({ clicks: 1, conversions: 0 }));

    const weeks = toWeeks(daily);

    expect(weeks).toHaveLength(2);
    expect(weeks[0].clicks).toBe(7);
    expect(weeks[1].clicks).toBe(3);
    expect(weeks[1].date).toBe(daily[7].date);
  });

  it("keeps a week of entirely zero-filled days as its own zero bucket, not omitted", () => {
    // Days 7-13 (the second week) are zero-filled; everything else has a
    // click. If the zero week were dropped, the chart would silently
    // compress two weeks apart into neighbours, which is the exact lie
    // emptySeries zero-fills the day series to prevent.
    const daily = daySeries(21, (i) => ({ clicks: i >= 7 && i < 14 ? 0 : 1 }));

    const weeks = toWeeks(daily);

    expect(weeks).toHaveLength(3);
    expect(weeks[0].clicks).toBe(7);
    expect(weeks[1].clicks).toBe(0);
    expect(weeks[2].clicks).toBe(7);
  });
});

describe("change", () => {
  it("is the share of the earlier figure", () => {
    expect(change(150, 100)).toBe(50);
    expect(change(50, 100)).toBe(-50);
  });

  it("offers no comparison when the earlier figure was zero, below zero or missing", () => {
    // A clawback can take an affiliate's earlier period below zero. Dividing
    // by it would print a recovery from -10 to 20 as a 300% fall.
    expect(change(20, -10)).toBeNull();
    expect(change(-5, -10)).toBeNull();
    expect(change(20, 0)).toBeNull();
    expect(change(20, null)).toBeNull();
    expect(change(20, undefined)).toBeNull();
  });
});

describe("earnedTrend", () => {
  const point = (date: string, amounts: DayPoint["amounts"]): DayPoint => ({
    date,
    clicks: 0,
    conversions: 0,
    revenue: 0,
    signups: 0,
    amounts,
  });

  it("draws a bucket below zero at zero, never below it", () => {
    const series = [
      point("2026-09-01", { usd: { gross: 30, commission: 30, sales: 1 } }),
      point("2026-09-02", { usd: { gross: -10, commission: -10, sales: 0 } }),
      point("2026-09-03", {}),
      point("2026-09-04", { eur: { gross: 12, commission: 12, sales: 1 } }),
    ];

    expect(earnedTrend(series, "usd")).toEqual([30, 0, 0, 0]);
    expect(earnedTrend(series, "eur")).toEqual([0, 0, 0, 12]);
  });
});
