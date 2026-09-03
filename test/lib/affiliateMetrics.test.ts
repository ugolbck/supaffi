// Destructive: clears Commission / Click / AffiliateLink / Affiliate / Program /
// Merchant / Owner. Runs against the scratch DATABASE_URL, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";

import { db } from "@/lib/db";
import {
  createAffiliate,
  getAffiliateCommissionTotals,
  listAffiliateCommissions,
  listAffiliatePayments,
} from "@/lib/affiliate";
import { getPrimaryLink } from "@/lib/affiliateLink";
import { getAffiliateMetrics } from "@/lib/analytics";

const hasDatabase = Boolean(process.env.DATABASE_URL);

async function clearAll() {
  await db.commission.deleteMany();
  await db.click.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

async function seedProgram() {
  const owner = await db.owner.create({
    data: { email: `owner-${crypto.randomUUID()}@example.com`, passwordHash: "x" },
  });
  const merchant = await db.merchant.create({
    data: {
      slug: crypto.randomUUID(),
      ownerId: owner.id,
      name: "InstantGradient",
      domain: `${crypto.randomUUID()}.example.com`,
      websiteUrl: "https://instantgradient.com",
    },
  });
  const program = await db.program.create({
    data: {
      merchantId: merchant.id,
      slug: "standard",
      name: "Standard",
      defaultCommissionRate: "20.00",
      commissionDurationType: "FOREVER",
      attributionWindowDays: 60,
      holdingPeriodDays: 30,
    },
  });
  return { owner, merchant, program };
}

afterAll(clearAll);

describe.skipIf(!hasDatabase)("affiliate metrics", () => {
  beforeEach(clearAll);

  it("reports zeros and a full zero-filled series for a brand new affiliate", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });

    const metrics = await getAffiliateMetrics(sarah.id, 30);
    expect(metrics.clicks).toBe(0);
    expect(metrics.conversions).toBe(0);
    // Zero, never NaN: an empty dashboard must not read "NaN%".
    expect(metrics.conversionRate).toBe(0);
    expect(metrics.unpaid).toEqual([]);
    // A chart that skips quiet days lies about the shape, so every day is present.
    expect(metrics.series).toHaveLength(30);
    expect(metrics.series.every((p) => p.clicks === 0 && p.conversions === 0)).toBe(true);
  });

  it("splits unpaid into pending and payable without converting currencies", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const primary = await getPrimaryLink(sarah.id);
    const click = await db.click.create({
      data: {
        affiliateId: sarah.id,
        linkId: primary!.id,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    for (const [status, amount, currency] of [
      ["PENDING", "10.00", "usd"],
      ["PAYABLE", "5.00", "usd"],
      ["PAYABLE", "7.00", "eur"],
      ["PAID", "100.00", "usd"],
      ["VOIDED", "50.00", "usd"],
    ] as const) {
      await db.commission.create({
        data: {
          affiliateId: sarah.id,
          clickId: click.id,
          amount,
          currency,
          status,
          payableAt: new Date(),
          stripePaymentRef: crypto.randomUUID(),
        },
      });
    }

    const metrics = await getAffiliateMetrics(sarah.id, 30);
    expect(metrics.pending).toEqual([{ currency: "usd", total: "10.00" }]);
    expect(metrics.payable).toEqual([
      { currency: "eur", total: "7.00" },
      { currency: "usd", total: "5.00" },
    ]);
    // Summed per currency, never across them.
    expect(metrics.unpaid).toEqual([
      { currency: "eur", total: "7.00" },
      { currency: "usd", total: "15.00" },
    ]);
    expect(metrics.paid).toEqual([{ currency: "usd", total: "100.00" }]);
    expect(metrics.clicks).toBe(1);
    expect(metrics.conversions).toBe(5);
  });

  it("folds a flagged commission into pending, in the tile counts and in the filtered rows", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const primary = await getPrimaryLink(sarah.id);
    const click = await db.click.create({
      data: {
        affiliateId: sarah.id,
        linkId: primary!.id,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    await db.commission.create({
      data: {
        affiliateId: sarah.id,
        clickId: click.id,
        amount: "9.00",
        currency: "usd",
        status: "FLAGGED",
        flagReason: "buyer email matches affiliate email",
        payableAt: new Date(),
        stripePaymentRef: crypto.randomUUID(),
      },
    });
    // A genuinely PENDING row, same currency as the flagged one above. This is
    // what rowsFor (src/lib/analytics.ts) exists to sum: two source rows that
    // both display as PENDING must merge into one summed bucket, not overwrite
    // one another. Without it, the single-flagged-row case above would still
    // pass even if rowsFor overwrote instead of accumulated.
    await db.commission.create({
      data: {
        affiliateId: sarah.id,
        clickId: click.id,
        amount: "4.00",
        currency: "usd",
        status: "PENDING",
        payableAt: new Date(Date.now() + 86400_000),
        stripePaymentRef: crypto.randomUUID(),
      },
    });

    const metrics = await getAffiliateMetrics(sarah.id, 30);
    expect(metrics.pending).toEqual([{ currency: "usd", total: "13.00" }]);

    const totals = await getAffiliateCommissionTotals(sarah.id);
    expect(totals).toEqual([
      { status: "PENDING", count: 2 },
      { status: "PAYABLE", count: 0 },
      { status: "PAID", count: 0 },
      { status: "VOIDED", count: 0 },
    ]);

    const { rows } = await listAffiliateCommissions(sarah.id, { page: 1, pageSize: 10, status: "PENDING" });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "PENDING")).toBe(true);
  });
});

describe.skipIf(!hasDatabase)("listAffiliatePayments", () => {
  beforeEach(clearAll);

  async function seedClick(affiliateId: string) {
    const primary = await getPrimaryLink(affiliateId);
    return db.click.create({
      data: {
        affiliateId,
        linkId: primary!.id,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
  }

  async function payCommission(
    affiliateId: string,
    clickId: string,
    amount: string,
    currency: string,
    paidAt: Date
  ) {
    return db.commission.create({
      data: {
        affiliateId,
        clickId,
        amount,
        currency,
        status: "PAID",
        payableAt: paidAt,
        paidAt,
        stripePaymentRef: crypto.randomUUID(),
      },
    });
  }

  it("collapses two commissions paid the same day in the same currency into one row", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const click = await seedClick(sarah.id);
    await payCommission(sarah.id, click.id, "10.00", "usd", new Date("2026-08-15T09:00:00.000Z"));
    await payCommission(sarah.id, click.id, "5.00", "usd", new Date("2026-08-15T18:00:00.000Z"));

    const payments = await listAffiliatePayments(sarah.id);
    expect(payments).toHaveLength(1);
    expect(payments[0].count).toBe(2);
    expect(payments[0].totals).toEqual([{ currency: "usd", total: "15.00" }]);
  });

  it("keeps two commissions paid on different days as separate rows, newest first", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const click = await seedClick(sarah.id);
    await payCommission(sarah.id, click.id, "10.00", "usd", new Date("2026-08-14T09:00:00.000Z"));
    await payCommission(sarah.id, click.id, "5.00", "usd", new Date("2026-08-15T09:00:00.000Z"));

    const payments = await listAffiliatePayments(sarah.id);
    expect(payments).toHaveLength(2);
    expect(payments[0].totals).toEqual([{ currency: "usd", total: "5.00" }]);
    expect(payments[0].count).toBe(1);
    expect(payments[1].totals).toEqual([{ currency: "usd", total: "10.00" }]);
    expect(payments[1].count).toBe(1);
  });

  it("keeps currencies separate within one day's row rather than summing across them", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const click = await seedClick(sarah.id);
    await payCommission(sarah.id, click.id, "10.00", "usd", new Date("2026-08-15T09:00:00.000Z"));
    await payCommission(sarah.id, click.id, "7.00", "eur", new Date("2026-08-15T18:00:00.000Z"));

    const payments = await listAffiliatePayments(sarah.id);
    expect(payments).toHaveLength(1);
    expect(payments[0].count).toBe(2);
    expect(payments[0].totals).toEqual([
      { currency: "eur", total: "7.00" },
      { currency: "usd", total: "10.00" },
    ]);
  });
});
