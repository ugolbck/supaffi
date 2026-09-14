// Destructive: clears Commission / ReferredSubscription / Click / AffiliateLink /
// Affiliate / Program / Merchant / Owner. Runs against the scratch DATABASE_URL
// that test/setup.ts enforces, never the dev one.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { Merchant, Prisma, Program } from "@prisma/client";
import { db } from "@/lib/db";
import {
  isWithinReferralDuration,
  readReferralHistory,
  referralStillEarns,
} from "@/lib/worker/referralDuration";
import {
  clearReferralTables,
  seedMerchant,
  seedOwner,
  seedReferral,
  seedReferredSubscription,
} from "./referralFixtures";

function programOf(type: Program["commissionDurationType"], months: number | null = null): Program {
  return { commissionDurationType: type, commissionDurationMonths: months } as Program;
}

const at = (iso: string) => new Date(iso);
const start = { ref: "in_first", at: at("2026-01-31T00:00:00Z") };

describe("isWithinReferralDuration", () => {
  it("pays a forever program whatever the referral already earned", () => {
    const history = { start, earnedOnAnotherPayment: true };
    expect(isWithinReferralDuration(programOf("FOREVER"), history, { ref: "in_60", at: at("2031-01-31T00:00:00Z") })).toBe(true);
  });

  it("pays a one-time program on the referral's first payment only", () => {
    const program = programOf("ONE_TIME");
    const history = { start, earnedOnAnotherPayment: false };
    expect(isWithinReferralDuration(program, history, start)).toBe(true);
    expect(isWithinReferralDuration(program, history, { ref: "in_other_subscription", at: at("2026-02-01T00:00:00Z") })).toBe(false);
  });

  it("pays a one-time program nothing once another payment of the referral earned, even on the first payment", () => {
    expect(isWithinReferralDuration(programOf("ONE_TIME"), { start, earnedOnAnotherPayment: true }, start)).toBe(false);
  });

  it("pays the first payment of a referral that has nothing yet", () => {
    for (const type of ["ONE_TIME", "FIXED_MONTHS"] as const) {
      expect(isWithinReferralDuration(programOf(type, 3), { start: null, earnedOnAnotherPayment: false }, start)).toBe(true);
    }
  });

  it("counts fixed months from the referral's first payment, whichever subscription a payment belongs to", () => {
    const program = programOf("FIXED_MONTHS", 3);
    const history = { start, earnedOnAnotherPayment: true };
    expect(isWithinReferralDuration(program, history, { ref: "in_second_sub", at: at("2026-04-15T00:00:00Z") })).toBe(true);
    expect(isWithinReferralDuration(program, history, { ref: "in_second_sub_2", at: at("2026-05-15T00:00:00Z") })).toBe(false);
  });
});

describe("readReferralHistory", () => {
  let merchant: Merchant;

  async function seedCommission(
    click: { id: string; affiliateId: string },
    ref: string | null,
    fields: Partial<Prisma.CommissionUncheckedCreateInput> = {}
  ) {
    return db.commission.create({
      data: {
        affiliateId: click.affiliateId,
        clickId: click.id,
        stripePaymentRef: ref,
        amount: 10,
        grossAmount: 10,
        currency: "usd",
        payableAt: new Date(),
        ...fields,
      },
    });
  }

  beforeEach(async () => {
    await clearReferralTables();
    merchant = await seedMerchant((await seedOwner()).id);
  });

  afterAll(async () => {
    await clearReferralTables();
    await db.$disconnect();
  });

  it("has nothing for a click whose only subscription is still on a free trial", async () => {
    const { click } = await seedReferral(merchant, { durationType: "ONE_TIME" });
    await seedReferredSubscription(merchant.id, click.id, "sub_trial");

    expect(await readReferralHistory(merchant.id, click.id, "in_new")).toEqual({
      start: null,
      earnedOnAnotherPayment: false,
    });
  });

  it("starts at the earliest first payment among the click's subscriptions, cancelled ones included", async () => {
    const { click } = await seedReferral(merchant, { durationType: "FIXED_MONTHS", months: 3 });
    await seedReferredSubscription(merchant.id, click.id, "sub_march", { ref: "in_march", at: at("2026-03-01T00:00:00Z") });
    const january = await seedReferredSubscription(merchant.id, click.id, "sub_january", {
      ref: "in_january",
      at: at("2026-01-10T00:00:00Z"),
    });
    await db.referredSubscription.update({ where: { id: january.id }, data: { cancelledAt: new Date() } });
    await seedReferredSubscription(merchant.id, click.id, "sub_trial");

    const history = await readReferralHistory(merchant.id, click.id, "in_new");

    expect(history.start?.ref).toBe("in_january");
    expect(history.start?.at.toISOString()).toBe("2026-01-10T00:00:00.000Z");
    expect(history.earnedOnAnotherPayment).toBe(false);
  });

  it("ignores subscription rows another product holds for the same click", async () => {
    const { click } = await seedReferral(merchant, { durationType: "FIXED_MONTHS", months: 3 });
    const other = await seedMerchant(merchant.ownerId);
    await seedReferredSubscription(other.id, click.id, "sub_other", { ref: "in_other", at: at("2025-12-01T00:00:00Z") });
    await seedReferredSubscription(merchant.id, click.id, "sub_own", { ref: "in_own", at: at("2026-01-10T00:00:00Z") });

    expect((await readReferralHistory(merchant.id, click.id, "in_new")).start?.ref).toBe("in_own");
  });

  it("starts at a one-time purchase's commission when it came before any subscription", async () => {
    const { click } = await seedReferral(merchant, { durationType: "FIXED_MONTHS", months: 3 });
    await seedCommission(click, "pi_once", { createdAt: at("2026-01-10T00:00:00Z") });
    await seedReferredSubscription(merchant.id, click.id, "sub_later", { ref: "in_later", at: at("2026-03-01T00:00:00Z") });

    const history = await readReferralHistory(merchant.id, click.id, "in_new");

    expect(history.start?.ref).toBe("pi_once");
    expect(history.start?.at.toISOString()).toBe("2026-01-10T00:00:00.000Z");
  });

  it.each<[string, Partial<Prisma.CommissionUncheckedCreateInput>]>([
    ["pending", { status: "PENDING" }],
    ["payable", { status: "PAYABLE" }],
    ["paid", { status: "PAID", paidAt: new Date() }],
    ["flagged", { status: "FLAGGED", flagReason: "card" }],
    ["held by a dispute", { status: "PENDING", disputeOpenedAt: new Date() }],
    ["voided by a refund", { status: "VOIDED", voidedAt: new Date(), voidReason: "refund" }],
    ["voided by a chargeback", { status: "VOIDED", voidedAt: new Date(), voidReason: "chargeback" }],
    ["voided by the owner", { status: "VOIDED", voidedAt: new Date(), voidReason: "refund (by owner)" }],
    ["voided as a confirmed self referral", { status: "VOIDED", voidedAt: new Date(), voidReason: "confirmed self-referral" }],
  ])("counts an earlier commission %s as already earned", async (_label, fields) => {
    const { click } = await seedReferral(merchant, { durationType: "ONE_TIME" });
    await seedCommission(click, "in_earlier", fields);

    expect((await readReferralHistory(merchant.id, click.id, "in_new")).earnedOnAnotherPayment).toBe(true);
  });

  it("does not count the payment's own commission or its refund adjustments, so a redelivery is not blocked by itself", async () => {
    const { click } = await seedReferral(merchant, { durationType: "ONE_TIME" });
    const own = await seedCommission(click, "in_own", { status: "PAID", paidAt: new Date() });
    await seedCommission(click, null, { adjustsCommissionId: own.id, amount: -5, grossAmount: null });

    expect((await readReferralHistory(merchant.id, click.id, "in_own")).earnedOnAnotherPayment).toBe(false);
  });

  it("counts a subscription payment that left no commission as the start, so it still spends the referral", async () => {
    // What an excluded checkout, or one that came to nothing, leaves behind.
    const { click } = await seedReferral(merchant, { durationType: "ONE_TIME" });
    await seedReferredSubscription(merchant.id, click.id, "sub_excluded", { ref: "in_excluded", at: at("2026-01-10T00:00:00Z") });

    const history = await readReferralHistory(merchant.id, click.id, "in_new");

    expect(history.start?.ref).toBe("in_excluded");
    expect(history.earnedOnAnotherPayment).toBe(false);
    expect(isWithinReferralDuration(programOf("ONE_TIME"), history, { ref: "in_new", at: at("2026-02-10T00:00:00Z") })).toBe(false);
  });

  it("asks the database nothing for a forever program", async () => {
    const queries = vi.spyOn(db, "$queryRaw");
    try {
      expect(await referralStillEarns(merchant.id, "no_click", programOf("FOREVER"), start)).toBe(true);
      expect(queries).not.toHaveBeenCalled();
    } finally {
      queries.mockRestore();
    }
  });

  it("has the index the read uses to find a click's commissions", async () => {
    const rows = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'Commission'
    `;
    expect(rows.map((row) => row.indexname)).toContain("Commission_clickId_createdAt_idx");
  });
});
