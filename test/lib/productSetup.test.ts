// Destructive: clears Program / Merchant / Owner. Runs against the scratch
// DATABASE_URL, never the dev one.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

import { db } from "@/lib/db";
import { getProductSetup, setupSteps, stepAfter } from "@/lib/productSetup";

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

  it("counts the integrations step done without an email provider in console mode", async () => {
    // The reason this exists: mail is sent from the Merchant's own domain, so
    // a local Merchant on `localhost:3600` can never connect a real provider,
    // and demanding one would make setup impossible to finish in development.
    vi.stubEnv("EMAIL_DELIVERY", "console");
    const { owner, merchant } = await seedMerchant(true);

    const setup = await getProductSetup(owner.id, merchant.id);
    expect(setup.emailRequired).toBe(false);
    expect(setup.emailConnected).toBe(false);
    expect(setup.integrationsConnected).toBe(true);
    expect(setup.doneCount).toBe(1);
  });

  it("still requires Stripe in console mode", async () => {
    vi.stubEnv("EMAIL_DELIVERY", "console");
    const { owner, merchant } = await seedMerchant(false);

    const setup = await getProductSetup(owner.id, merchant.id);
    expect(setup.integrationsConnected).toBe(false);
    expect(setup.doneCount).toBe(0);
  });

  it("requires an email provider when the instance actually sends", async () => {
    vi.stubEnv("EMAIL_DELIVERY", "send");
    const { owner, merchant } = await seedMerchant(true);

    const setup = await getProductSetup(owner.id, merchant.id);
    expect(setup.emailRequired).toBe(true);
    expect(setup.integrationsConnected).toBe(false);
    expect(setup.doneCount).toBe(0);
  });

  it("is complete with tools, terms and tracking done, and nobody recruited yet", async () => {
    // Recruiting an affiliate is using the product, not setting it up. Counting
    // it kept a working product reading "3 of 4" forever, and kept the step rail
    // on screens that had stopped being onboarding.
    vi.stubEnv("EMAIL_DELIVERY", "console");
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
    vi.stubEnv("EMAIL_DELIVERY", "console");
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

describe("setup step order", () => {
  const base: Awaited<ReturnType<typeof getProductSetup>> = {
    stripeConnected: true,
    emailConnected: true,
    emailRequired: true,
    integrationsConnected: true,
    firstProgramSlug: "p1",
    trackingStatus: "not-started",
    affiliateCount: 0,
    doneCount: 2,
    totalSteps: 3,
    complete: false,
  };

  it("sends every step forward, never back at itself", () => {
    // The dead end this exists to prevent: a "first unfinished" lookup would
    // point the tracking screen at the tracking screen and offer no way on.
    expect(stepAfter("m1", base, 2)?.href).toBe("/dashboard/products/m1/tracking");
    expect(stepAfter("m1", base, 3)).toBeNull();
  });

  it("skips steps already done", () => {
    expect(stepAfter("m1", base, 1)?.href).toBe("/dashboard/products/m1/tracking");
  });

  it("counts tracking as handled once clicks arrive", () => {
    // Nothing the Owner can do moves it further, so it must not block the way
    // forward for the steps behind it.
    const arriving = { ...base, trackingStatus: "awaiting-sale" as const };
    expect(setupSteps("m1", arriving).find((s) => s.id === "tracking")?.done).toBe(true);
  });

  it("is null at the end of the sequence", () => {
    const tracked = { ...base, trackingStatus: "awaiting-sale" as const };
    expect(stepAfter("m1", tracked, 2)).toBeNull();
    expect(stepAfter("m1", base, 3)).toBeNull();
  });
});
