// Destructive: clears Commission / Click / Affiliate / Program / Merchant /
// Owner. Run against the scratch DATABASE_URL, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";

import { db } from "@/lib/db";
import {
  getTrackingStatus,
  recordTrackingVerified,
  shouldCelebrateTracking,
  markTrackingCelebrationSeen,
  getTrackingTimestamps,
} from "@/lib/tracking";

// Real database, same as the other lib suites. Runs against the scratch
// DATABASE_URL, never the dev one.
async function seedMerchant() {
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
      commissionDurationType: "FOREVER" as const,
      commissionDurationMonths: null,
      attributionWindowDays: 60,
      holdingPeriodDays: 30,
    },
  });
  return { merchant, program };
}

async function seedClick(merchantId: string, programId: string, stripeCustomerId?: string) {
  const affiliate = await db.affiliate.create({
    data: {
      merchantId,
      programId,
      email: `aff-${crypto.randomUUID()}@example.com`,
      referralCode: crypto.randomUUID(),
    },
  });
  return db.click.create({
    data: {
      affiliateId: affiliate.id,
      referralToken: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
      stripeCustomerId,
    },
  });
}

async function clearAll() {
  await db.commission.deleteMany();
  await db.click.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

// Cleared afterwards as well as before: this is the only suite that seeds a
// Program, and merchant.test.ts deletes Merchants without deleting Programs
// first, so anything left behind breaks it whenever file order puts it after
// this one.
afterAll(clearAll);

describe("tracking status", () => {
  beforeEach(clearAll);

  it("is not-started until something has actually been recorded", async () => {
    const { merchant } = await seedMerchant();
    expect(await getTrackingStatus(merchant.id)).toBe("not-started");
  });

  it("is awaiting-sale once a click exists, since that only proves the script half", async () => {
    const { merchant, program } = await seedMerchant();
    await seedClick(merchant.id, program.id);

    // The Owner may move on from here: nothing they can do makes a customer
    // buy, and the checkout half cannot be proven without one.
    expect(await getTrackingStatus(merchant.id)).toBe("awaiting-sale");
  });

  it("is verified once an attributed checkout has been recorded", async () => {
    const { merchant, program } = await seedMerchant();
    await seedClick(merchant.id, program.id);
    await recordTrackingVerified(merchant.id);

    expect(await getTrackingStatus(merchant.id)).toBe("verified");
  });

  it("does not count another Merchant's clicks", async () => {
    // Both live on one instance (ADR 0006), so a status query that forgot to
    // scope would tell an Owner their integration works because someone
    // else's does.
    const mine = await seedMerchant();
    const theirs = await seedMerchant();
    await seedClick(theirs.merchant.id, theirs.program.id);

    expect(await getTrackingStatus(mine.merchant.id)).toBe("not-started");
  });

  it("keeps the timestamp of the first attributed sale, not the latest", async () => {
    // The celebration is keyed off this, so a later sale overwriting it would
    // re-fire a moment that was already spent.
    const { merchant } = await seedMerchant();
    await recordTrackingVerified(merchant.id);
    const first = await db.merchant.findUnique({
      where: { id: merchant.id },
      select: { trackingVerifiedAt: true },
    });

    await recordTrackingVerified(merchant.id);
    const second = await db.merchant.findUnique({
      where: { id: merchant.id },
      select: { trackingVerifiedAt: true },
    });

    expect(second!.trackingVerifiedAt).toEqual(first!.trackingVerifiedAt);
  });
});

describe("tracking celebration", () => {
  beforeEach(clearAll);

  it("does not celebrate a Merchant that has never been verified", async () => {
    const { merchant } = await seedMerchant();
    expect(await shouldCelebrateTracking(merchant.id)).toBe(false);
  });

  it("celebrates once and then never again", async () => {
    const { merchant } = await seedMerchant();
    await recordTrackingVerified(merchant.id);

    expect(await shouldCelebrateTracking(merchant.id)).toBe(true);
    await markTrackingCelebrationSeen(merchant.id);
    expect(await shouldCelebrateTracking(merchant.id)).toBe(false);
  });

  it("keeps the first seen stamp when two tabs render at once", async () => {
    const { merchant } = await seedMerchant();
    await recordTrackingVerified(merchant.id);

    await markTrackingCelebrationSeen(merchant.id);
    const first = await db.merchant.findUnique({
      where: { id: merchant.id },
      select: { trackingVerifiedSeenAt: true },
    });

    await markTrackingCelebrationSeen(merchant.id);
    const second = await db.merchant.findUnique({
      where: { id: merchant.id },
      select: { trackingVerifiedSeenAt: true },
    });

    expect(second!.trackingVerifiedSeenAt).toEqual(first!.trackingVerifiedSeenAt);
  });
});

describe("tracking timestamps", () => {
  beforeEach(clearAll);

  it("is both null with nothing recorded yet", async () => {
    const { merchant } = await seedMerchant();
    expect(await getTrackingTimestamps(merchant.id)).toEqual({
      lastClickAt: null,
      verifiedAt: null,
    });
  });

  it("returns the most recent click, not the first one recorded", async () => {
    const { merchant, program } = await seedMerchant();
    const older = await seedClick(merchant.id, program.id);
    const newer = await seedClick(merchant.id, program.id);
    // Backdated after the fact: two clicks made in the same test run can land
    // in the same millisecond, which would make a naive "insert order" test
    // pass by accident even if the query's ORDER BY were wrong.
    await db.click.update({
      where: { id: older.id },
      data: { createdAt: new Date(Date.now() - 86_400_000) },
    });

    const { lastClickAt } = await getTrackingTimestamps(merchant.id);
    expect(lastClickAt?.getTime()).toBe(newer.createdAt.getTime());
  });

  it("carries the same verifiedAt recordTrackingVerified wrote", async () => {
    const { merchant } = await seedMerchant();
    await recordTrackingVerified(merchant.id);
    const raw = await db.merchant.findUnique({
      where: { id: merchant.id },
      select: { trackingVerifiedAt: true },
    });

    const { verifiedAt } = await getTrackingTimestamps(merchant.id);
    expect(verifiedAt?.getTime()).toBe(raw!.trackingVerifiedAt!.getTime());
  });

  it("does not read another Merchant's click", async () => {
    const mine = await seedMerchant();
    const theirs = await seedMerchant();
    await seedClick(theirs.merchant.id, theirs.program.id);

    expect(await getTrackingTimestamps(mine.merchant.id)).toEqual({
      lastClickAt: null,
      verifiedAt: null,
    });
  });
});
