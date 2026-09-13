// Destructive: clears Commission / Click / AffiliateLink / Affiliate / Program /
// Merchant / Owner. Runs against the scratch DATABASE_URL that test/setup.ts
// enforces, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";

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

describe("Commission money columns", () => {
  let affiliateId: string;
  let clickId: string;

  beforeEach(async () => {
    await clearAll();
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
      },
    });
    const affiliate = await db.affiliate.create({
      data: { merchantId: merchant.id, programId: program.id, email: `aff-${crypto.randomUUID()}@example.com` },
    });
    affiliateId = affiliate.id;
    const click = await db.click.create({
      data: { affiliateId, referralToken: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
    });
    clickId = click.id;
  });

  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("holds a dong sale far above what ten digits allowed", async () => {
    // 250 billion VND is roughly ten thousand dollars. Decimal(10,2) topped
    // out at 99,999,999.99, so the insert failed and the event was retried
    // until it gave up.
    const created = await db.commission.create({
      data: {
        affiliateId,
        clickId,
        stripePaymentRef: "pi_vnd_large",
        amount: "50000000000.00",
        grossAmount: "50000000000.00",
        saleAmount: "250000000000.00",
        currency: "vnd",
        status: "PENDING",
        payableAt: new Date(),
      },
    });

    const read = await db.commission.findUniqueOrThrow({ where: { id: created.id } });
    expect(read.saleAmount?.toString()).toBe("250000000000");
    expect(read.amount.toString()).toBe("50000000000");
    expect(read.grossAmount?.toString()).toBe("50000000000");
  });
});
