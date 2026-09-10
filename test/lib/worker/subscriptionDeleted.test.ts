// Destructive: clears Commission / Click / AffiliateLink / Affiliate / Program /
// Merchant / Owner. Runs against the scratch DATABASE_URL that test/setup.ts
// enforces, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";

import { db } from "@/lib/db";
import { handleSubscriptionDeleted } from "@/lib/worker/handlers/subscriptionDeleted";
import { referralCounts } from "@/lib/affiliate";

async function clearAll() {
  await db.commission.deleteMany();
  await db.click.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

describe("handleSubscriptionDeleted", () => {
  let merchant: Merchant;
  let affiliateId: string;
  let clickId: string;

  beforeEach(async () => {
    await clearAll();

    const owner = await db.owner.create({
      data: { email: `owner-${crypto.randomUUID()}@example.com`, passwordHash: "x" },
    });
    merchant = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: owner.id,
        name: "InstantGradient",
        domain: `${crypto.randomUUID()}.example.com`,
        websiteUrl: "https://instantgradient.com",
        stripeSecretKeyEnc: "x",
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
    affiliateId = affiliate.id;
    const click = await db.click.create({
      data: {
        affiliateId: affiliate.id,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
        stripeCustomerId: "cus_1",
      },
    });
    clickId = click.id;
  });

  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("marks the click that brought the cancelled customer", async () => {
    await handleSubscriptionDeleted(merchant, { customer: "cus_1" } as Stripe.Subscription);
    const click = await db.click.findUnique({ where: { stripeCustomerId: "cus_1" } });
    expect(click?.subscriptionCancelledAt).toBeInstanceOf(Date);
  });

  it("ignores a customer nobody referred", async () => {
    await expect(
      handleSubscriptionDeleted(merchant, { customer: "cus_unknown" } as Stripe.Subscription)
    ).resolves.toBeUndefined();
  });

  describe("referralCounts", () => {
    it("counts a click with a commission and no cancellation as total 1 active 1", async () => {
      await db.commission.create({
        data: {
          affiliateId,
          clickId,
          stripePaymentRef: "pi_1",
          amount: 15.6,
          grossAmount: 15.6,
          currency: "usd",
          saleAmount: 78,
          status: "PENDING",
          payableAt: new Date(),
        },
      });

      expect(await referralCounts(affiliateId)).toEqual({ total: 1, active: 1 });
    });

    it("counts total 1 active 0 after the subscription is cancelled", async () => {
      await db.commission.create({
        data: {
          affiliateId,
          clickId,
          stripePaymentRef: "pi_1",
          amount: 15.6,
          grossAmount: 15.6,
          currency: "usd",
          saleAmount: 78,
          status: "PENDING",
          payableAt: new Date(),
        },
      });

      await handleSubscriptionDeleted(merchant, { customer: "cus_1" } as Stripe.Subscription);

      expect(await referralCounts(affiliateId)).toEqual({ total: 1, active: 0 });
    });

    it("counts a click with no commission in neither total nor active", async () => {
      await db.click.create({
        data: {
          affiliateId,
          referralToken: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      expect(await referralCounts(affiliateId)).toEqual({ total: 0, active: 0 });
    });
  });
});
