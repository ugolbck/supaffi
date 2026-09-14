// Destructive: clears Commission / ReferredSubscription / Click / AffiliateLink /
// Affiliate / Program / Merchant / Owner. Runs against the scratch DATABASE_URL
// that test/setup.ts enforces, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { createCommissionUnlessSelfReferral } from "@/lib/worker/recordCommission";
import { clearReferralTables, seedMerchant, seedOwner, seedReferral } from "./referralFixtures";

const DAY = 24 * 60 * 60 * 1000;

function commissionData(affiliateId: string, clickId: string, stripePaymentRef: string) {
  return {
    affiliateId,
    clickId,
    stripePaymentRef,
    amount: "10.00",
    grossAmount: "10.00",
    currency: "usd",
    status: "PENDING" as const,
    payableAt: new Date(Date.now() + 30 * DAY),
  };
}

describe("createCommissionUnlessSelfReferral", () => {
  beforeEach(async () => {
    await clearReferralTables();
  });

  afterAll(async () => {
    await clearReferralTables();
    await db.$disconnect();
  });

  async function referral() {
    const merchant = await seedMerchant((await seedOwner()).id);
    return seedReferral(merchant);
  }

  it("writes the commission on a referral nobody confirmed", async () => {
    const { affiliate, click } = await referral();

    expect(await createCommissionUnlessSelfReferral({ data: commissionData(affiliate.id, click.id, "in_1") })).toBe(true);
    expect(await db.commission.count({ where: { clickId: click.id } })).toBe(1);
  });

  it("writes nothing on a referral confirmed as a self referral", async () => {
    const { affiliate, click } = await referral();
    await db.click.update({ where: { id: click.id }, data: { fraudConfirmedAt: new Date() } });

    expect(await createCommissionUnlessSelfReferral({ data: commissionData(affiliate.id, click.id, "in_1") })).toBe(false);
    expect(await db.commission.count()).toBe(0);
  });

  it("waits for a confirmation in progress and then writes nothing", async () => {
    const { affiliate, click } = await referral();

    let writing!: Promise<boolean>;
    await db.$transaction(async (tx) => {
      // What confirmCommissionFraud holds while it voids and marks the click.
      await tx.$queryRaw`SELECT id FROM "Click" WHERE id = ${click.id} FOR UPDATE`;
      writing = createCommissionUnlessSelfReferral({ data: commissionData(affiliate.id, click.id, "in_1") });
      // Long enough for the write to reach the click and wait on it.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await tx.click.update({ where: { id: click.id }, data: { fraudConfirmedAt: new Date() } });
    });

    expect(await writing).toBe(false);
    expect(await db.commission.count()).toBe(0);
  });

  it("still reports a redelivered payment as the unique constraint error its callers expect", async () => {
    const { affiliate, click } = await referral();
    await createCommissionUnlessSelfReferral({ data: commissionData(affiliate.id, click.id, "in_1") });

    const err = await createCommissionUnlessSelfReferral({ data: commissionData(affiliate.id, click.id, "in_1") }).catch(
      (e: unknown) => e
    );
    expect(isUniqueConstraintError(err)).toBe(true);
    expect(await db.commission.count()).toBe(1);
  });
});
