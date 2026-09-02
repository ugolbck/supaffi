// Destructive: clears Commission / Click / Affiliate / Program / Merchant /
// Owner before each test. Runs against the scratch DATABASE_URL.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  getProductMetrics,
  getTopAffiliates,
  getRecentActivity,
  getPayableGroups,
  getOwnerMetrics,
} from "@/lib/analytics";

const hasDatabase = Boolean(process.env.DATABASE_URL);

async function clearAll() {
  await db.commission.deleteMany();
  await db.click.deleteMany();
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
        referralCode: `code-${suffix}-${crypto.randomUUID().slice(0, 8)}`,
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
      },
    });
  }

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

  it("keeps owed money per currency and counts PENDING with PAYABLE", async () => {
    const affiliate = await makeAffiliate("a");
    const click = await makeClick(affiliate.id);
    await makeCommission(affiliate.id, click.id, { amount: "10.00", status: "PENDING" });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "15.50",
      status: "PAYABLE",
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
      { currency: "usd", total: "25.50" },
    ]);
    expect(metrics.paid).toEqual([{ currency: "usd", total: "99.00" }]);
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

  it("interleaves commissions and signups, newest first", async () => {
    const affiliate = await makeAffiliate("a");
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});

    const activity = await getRecentActivity(ownerId, merchantId, 10);

    expect(activity.map((a) => a.kind)).toEqual(["commission", "signup"]);
    expect(activity[0].amount).toBe("10.00");
    expect(activity[1].amount).toBeNull();
  });

  it("rolls every product up for the owner-level view", async () => {
    const affiliate = await makeAffiliate("a");
    await makeClick(affiliate.id);
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "12.00",
      status: "FLAGGED",
    });

    const metrics = await getOwnerMetrics(ownerId, 30);

    expect(metrics.products).toBe(2);
    expect(metrics.affiliates).toBe(1);
    expect(metrics.clicks).toBe(2);
    expect(metrics.flagged).toBe(1);
  });
});
