// Destructive: clears Commission / Click / AffiliateLink / Affiliate / Program /
// Merchant / Owner. Runs against the scratch DATABASE_URL, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";

import { db } from "@/lib/db";
import { createAffiliate, getAffiliateCommissionTotals, listAffiliateCommissions } from "@/lib/affiliate";
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

    const totals = await getAffiliateCommissionTotals(sarah.id);
    expect(totals).toEqual([
      { status: "PENDING", count: 1 },
      { status: "PAYABLE", count: 0 },
      { status: "PAID", count: 0 },
      { status: "VOIDED", count: 0 },
    ]);

    const { rows } = await listAffiliateCommissions(sarah.id, { page: 1, pageSize: 10, status: "PENDING" });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PENDING");
  });
});
