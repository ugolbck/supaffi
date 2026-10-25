// Destructive: clears Commission / Click / AffiliateLink / Affiliate / Program /
// Merchant / Owner. Runs against the scratch DATABASE_URL that test/setup.ts
// enforces, never the dev one.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";

import { db } from "@/lib/db";

// Only reached when recognising a referral from before 0.2.6.
const stripeStub = vi.hoisted(() => ({
  invoices: { retrieve: vi.fn(async (_id: string): Promise<unknown> => undefined) },
  subscriptions: {
    list: vi.fn(async (_params: unknown): Promise<unknown> => ({ data: [], has_more: false })),
    // Read when a legacy referral is recognised, for the products it bills.
    retrieve: vi.fn(async (id: string): Promise<unknown> => ({
      id,
      items: { data: [{ id: "si_basic", price: { product: "prod_basic" } }], has_more: false },
    })),
  },
}));
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe")>("@/lib/stripe");
  return { ...actual, stripeClientFor: () => stripeStub as unknown as Stripe };
});

import { handleSubscriptionDeleted } from "@/lib/worker/handlers/subscriptionDeleted";
import { referralCounts } from "@/lib/affiliate";
import {
  retrievedInvoice,
  seedInvoiceCommission,
  seedLegacyClick,
  seedMerchant,
  seedReferredSubscription,
} from "./referralFixtures";

function deleted(id: string, customer = "cus_1"): Stripe.Subscription {
  return { id, customer } as Stripe.Subscription;
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

describe("handleSubscriptionDeleted", () => {
  let merchant: Merchant;
  let affiliateId: string;
  let clickId: string;

  beforeEach(async () => {
    await clearAll();
    stripeStub.invoices.retrieve.mockReset();
    stripeStub.subscriptions.list.mockReset();
    stripeStub.subscriptions.list.mockImplementation(async () => ({ data: [], has_more: false }));

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
      },
    });
    clickId = click.id;
  });

  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("marks the referred subscription and its click cancelled", async () => {
    await seedReferredSubscription(merchant.id, clickId, "sub_1");

    await handleSubscriptionDeleted(merchant, deleted("sub_1"));

    const referred = await db.referredSubscription.findFirstOrThrow({ where: { clickId } });
    expect(referred.cancelledAt).toBeInstanceOf(Date);
    expect((await db.click.findUniqueOrThrow({ where: { id: clickId } })).subscriptionCancelledAt).toBeInstanceOf(Date);
  });

  it("keeps the click paying while another subscription it brought is still active", async () => {
    await seedReferredSubscription(merchant.id, clickId, "sub_1");
    await seedReferredSubscription(merchant.id, clickId, "sub_2");

    await handleSubscriptionDeleted(merchant, deleted("sub_1"));

    expect((await db.click.findUniqueOrThrow({ where: { id: clickId } })).subscriptionCancelledAt).toBeNull();
  });

  it("ignores an unreferred subscription of a referred customer", async () => {
    await seedReferredSubscription(merchant.id, clickId, "sub_1");

    await handleSubscriptionDeleted(merchant, deleted("sub_unreferred"));

    expect((await db.click.findUniqueOrThrow({ where: { id: clickId } })).subscriptionCancelledAt).toBeNull();
  });

  it("ignores another product's subscription on a shared Stripe account", async () => {
    const other = await seedMerchant(merchant.ownerId);
    await seedReferredSubscription(merchant.id, clickId, "sub_1");

    await handleSubscriptionDeleted(other, deleted("sub_1"));

    expect((await db.referredSubscription.findFirstOrThrow({ where: { clickId } })).cancelledAt).toBeNull();
  });

  it("recognises and marks a referral from before this release when its cancellation is the first event seen", async () => {
    await seedLegacyClick(clickId, "cus_1");
    await seedInvoiceCommission(affiliateId, clickId, "in_first");
    stripeStub.invoices.retrieve.mockResolvedValueOnce(retrievedInvoice("in_first", "sub_1"));

    await handleSubscriptionDeleted(merchant, deleted("sub_1"));

    expect((await db.referredSubscription.findFirstOrThrow({ where: { clickId } })).cancelledAt).toBeInstanceOf(Date);
    expect((await db.click.findUniqueOrThrow({ where: { id: clickId } })).subscriptionCancelledAt).toBeInstanceOf(Date);
  });

  it("ignores a customer nobody referred, without asking Stripe", async () => {
    await expect(handleSubscriptionDeleted(merchant, deleted("sub_x", "cus_unknown"))).resolves.toBeUndefined();
    expect(stripeStub.invoices.retrieve).not.toHaveBeenCalled();
    expect(stripeStub.subscriptions.list).not.toHaveBeenCalled();
  });

  describe("referralCounts", () => {
    it("counts a click with a commission and no cancellation as total 1 active 1", async () => {
      await seedReferredSubscription(merchant.id, clickId, "sub_1");
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

    it("does not count a click with a commission from a one-time purchase", async () => {
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

      expect(await referralCounts(affiliateId)).toEqual({ total: 0, active: 0 });
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
      await seedReferredSubscription(merchant.id, clickId, "sub_1", { ref: "pi_1", at: new Date() });

      await handleSubscriptionDeleted(merchant, deleted("sub_1"));

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

    it("does not count a referral confirmed as a self referral as still paying", async () => {
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
      await seedReferredSubscription(merchant.id, clickId, "sub_1");
      await db.click.update({ where: { id: clickId }, data: { fraudConfirmedAt: new Date() } });

      expect(await referralCounts(affiliateId)).toEqual({ total: 1, active: 0 });
    });
  });
});
