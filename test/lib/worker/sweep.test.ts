// Destructive: clears Commission / ReferredSubscription / Click / AffiliateLink /
// Affiliate / Program / Merchant / Owner. Runs against the scratch DATABASE_URL
// that test/setup.ts enforces, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";

import { db } from "@/lib/db";
import { sweepPayableCommissions } from "@/lib/worker/sweep";

const DAY = 24 * 60 * 60 * 1000;

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

describe("sweepPayableCommissions", () => {
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
      data: { affiliateId, referralToken: crypto.randomUUID(), expiresAt: new Date(Date.now() + DAY) },
    });
    clickId = click.id;
  });

  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  function givenCommission(data: { disputeOpenedAt?: Date | null }) {
    return db.commission.create({
      data: {
        affiliateId,
        clickId,
        stripePaymentRef: crypto.randomUUID(),
        amount: "10.00",
        grossAmount: "10.00",
        currency: "usd",
        status: "PENDING",
        // A day in the past, far from any clock or time zone edge.
        payableAt: new Date(Date.now() - DAY),
        disputeOpenedAt: data.disputeOpenedAt ?? null,
      },
    });
  }

  it("makes a commission past its holding period payable", async () => {
    const commission = await givenCommission({});
    await sweepPayableCommissions();
    expect((await db.commission.findUniqueOrThrow({ where: { id: commission.id } })).status).toBe("PAYABLE");
  });

  it("leaves a commission held by an open dispute pending past its holding period", async () => {
    const commission = await givenCommission({ disputeOpenedAt: new Date() });
    await sweepPayableCommissions();
    expect((await db.commission.findUniqueOrThrow({ where: { id: commission.id } })).status).toBe("PENDING");
  });
});
