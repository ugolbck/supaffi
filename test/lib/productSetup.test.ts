// Destructive: clears Program / Merchant / Owner. Runs against the scratch
// DATABASE_URL, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";

import { db } from "@/lib/db";
import { getProductSetup } from "@/lib/productSetup";

const hasDatabase = Boolean(process.env.DATABASE_URL);

async function seedMerchant(stripeConnected: boolean) {
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
      stripeSecretKeyEnc: stripeConnected ? "enc" : null,
      stripeWebhookSecretEnc: stripeConnected ? "enc" : null,
    },
  });
  return { owner, merchant };
}

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

afterAll(clearAll);

describe.skipIf(!hasDatabase)("product setup", () => {
  beforeEach(clearAll);

  it("counts the integrations step done once Stripe is connected", async () => {
    const { owner, merchant } = await seedMerchant(true);

    const setup = await getProductSetup(owner.id, merchant.id);
    expect(setup.integrationsConnected).toBe(true);
    expect(setup.doneCount).toBe(1);
  });

  it("requires Stripe", async () => {
    const { owner, merchant } = await seedMerchant(false);

    const setup = await getProductSetup(owner.id, merchant.id);
    expect(setup.integrationsConnected).toBe(false);
    expect(setup.doneCount).toBe(0);
  });

  it("is complete with tools, terms and tracking done, and nobody recruited yet", async () => {
    // Recruiting an affiliate is using the product, not setting it up. Counting
    // it kept a working product reading "3 of 4" forever, and kept the step rail
    // on screens that had stopped being onboarding.
    const { owner, merchant } = await seedMerchant(true);
    await db.program.create({
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
    await db.merchant.update({
      where: { id: merchant.id },
      data: { trackingVerifiedAt: new Date() },
    });

    const setup = await getProductSetup(owner.id, merchant.id);
    expect(setup.totalSteps).toBe(3);
    expect(setup.affiliateCount).toBe(0);
    expect(setup.doneCount).toBe(3);
    expect(setup.complete).toBe(true);
  });

  it("is complete on clicks alone, before any sale has verified tracking", async () => {
    // The case the rule change was actually about. `awaiting-sale` means the
    // snippet is firing and there is nothing further the Owner can do; only a
    // paying customer arriving through a link can move it to verified, and
    // waiting on that kept a finished product showing the step rail forever.
    const { owner, merchant } = await seedMerchant(true);
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
    const affiliate = await db.affiliate.create({
      data: {
        merchantId: merchant.id,
        programId: program.id,
        email: `a-${crypto.randomUUID()}@example.com`,
        links: { create: { code: crypto.randomUUID(), isPrimary: true } },
      },
    });
    await db.click.create({
      data: {
        affiliateId: affiliate.id,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60 * 86400_000),
      },
    });

    const setup = await getProductSetup(owner.id, merchant.id);
    expect(merchant.trackingVerifiedAt).toBeNull();
    expect(setup.trackingStatus).toBe("awaiting-sale");
    expect(setup.doneCount).toBe(3);
    expect(setup.complete).toBe(true);
  });
});
