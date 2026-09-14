// Destructive: clears Commission / ReferredSubscription / Click / AffiliateLink /
// Affiliate / Program / Merchant / Owner. Runs against the scratch
// DATABASE_URL that test/setup.ts enforces, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";

const MIGRATION = "prisma/migrations/20260914130000_void_unpaid_refund_adjustments/migration.sql";

async function clearAll() {
  await db.commission.deleteMany({ where: { adjustsCommissionId: { not: null } } });
  await db.commission.deleteMany();
  await db.referredSubscription.deleteMany();
  await db.click.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

describe("void unpaid refund adjustments migration", () => {
  beforeEach(clearAll);
  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("voids every unpaid adjustment row and leaves everything else as it was", async () => {
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
        slug: crypto.randomUUID(),
        merchantId: merchant.id,
        name: "Standard",
        defaultCommissionRate: 20,
        commissionDurationType: "FOREVER",
        attributionWindowDays: 60,
        holdingPeriodDays: 30,
      },
    });
    const affiliate = await db.affiliate.create({
      data: {
        merchantId: merchant.id,
        programId: program.id,
        email: `aff-${crypto.randomUUID()}@example.com`,
        links: { create: { code: crypto.randomUUID(), isPrimary: true } },
      },
    });
    const click = await db.click.create({
      data: { affiliateId: affiliate.id, referralToken: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
    });
    const base = { affiliateId: affiliate.id, clickId: click.id, currency: "usd", payableAt: new Date() };

    const paidSale = await db.commission.create({
      data: { ...base, amount: "30.00", status: "PAID", paidAt: new Date(), stripePaymentRef: "in_paid" },
    });
    const payableSale = await db.commission.create({
      data: { ...base, amount: "12.00", status: "PAYABLE", stripePaymentRef: "in_payable" },
    });
    const payableAdjustment = await db.commission.create({
      data: { ...base, amount: "-10.00", status: "PAYABLE", adjustsCommissionId: paidSale.id },
    });
    const pendingAdjustment = await db.commission.create({
      data: { ...base, amount: "-5.00", status: "PENDING", adjustsCommissionId: paidSale.id },
    });
    const paidAdjustment = await db.commission.create({
      data: { ...base, amount: "-2.00", status: "PAID", paidAt: new Date(), adjustsCommissionId: paidSale.id },
    });

    await db.$executeRawUnsafe(readFileSync(MIGRATION, "utf8"));

    for (const id of [payableAdjustment.id, pendingAdjustment.id]) {
      const row = await db.commission.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe("VOIDED");
      expect(row.voidReason).toBe("refund after payout");
      expect(Math.abs(row.voidedAt!.getTime() - Date.now())).toBeLessThan(60_000);
    }
    expect((await db.commission.findUniqueOrThrow({ where: { id: paidAdjustment.id } })).status).toBe("PAID");
    expect((await db.commission.findUniqueOrThrow({ where: { id: paidSale.id } })).status).toBe("PAID");
    const untouched = await db.commission.findUniqueOrThrow({ where: { id: payableSale.id } });
    expect(untouched.status).toBe("PAYABLE");
    expect(untouched.voidedAt).toBeNull();
  });
});
