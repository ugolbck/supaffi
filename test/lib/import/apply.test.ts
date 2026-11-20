// Destructive: clears Email / Commission / Payout / ReferredSubscription /
// Click / AffiliateLink / Affiliate / Program / Import / Merchant / Owner.
// Runs against the scratch DATABASE_URL that test/setup.ts enforces.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { applyImport } from "@/lib/import/apply";
import { previewImport } from "@/lib/import/preview";
import type { FetchedProgram } from "@/lib/import/types";

async function clearAll() {
  await db.email.deleteMany();
  await db.commission.deleteMany();
  await db.payout.deleteMany();
  await db.referredSubscription.deleteMany();
  await db.click.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.retiredLinkCode.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.import.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

const PAID_AT = "2026-01-15T00:00:00.000Z";

const FETCHED: FetchedProgram = {
  referralParam: "ref",
  campaigns: [
    { id: "c1", name: "VIP" },
    { id: "c2", name: "Standard" },
  ],
  affiliates: [
    { id: "a1", email: "Sarah@Example.com", name: "Sarah", campaignId: "c1", codes: ["Sarah", "taken", "sarah_old"], paypalEmail: "s@paypal.test", wiseEmail: null },
    { id: "a2", email: "tom@example.com", name: "Tom", campaignId: "c2", codes: [], paypalEmail: null, wiseEmail: "t@wise.test" },
    { id: "a3", email: "here@example.com", name: "Here", campaignId: "c1", codes: ["here-old"], paypalEmail: null, wiseEmail: null },
  ],
  referrals: [{ id: "r1", affiliateId: "a1", stripeCustomerId: null, subscriptionId: "sub_1", createdAt: "2025-11-01T00:00:00.000Z" }],
  commissions: [
    { id: "k1", affiliateId: "a1", referralId: "r1", amount: "30.00", currency: "usd", state: "owed", createdAt: "2025-12-01T00:00:00.000Z", paidAt: null },
    { id: "k2", affiliateId: "a1", referralId: "r1", amount: "12.50", currency: "usd", state: "paid", createdAt: "2025-11-01T00:00:00.000Z", paidAt: PAID_AT },
    // Paid the same day as k2 but stamped later: one payout, as it was.
    { id: "k3", affiliateId: "a1", referralId: null, amount: "7.50", currency: "usd", state: "paid", createdAt: "2025-11-02T00:00:00.000Z", paidAt: "2026-01-15T09:30:00.000Z" },
    { id: "k4", affiliateId: "a1", referralId: "r1", amount: "9.00", currency: "usd", state: "void", createdAt: "2025-11-03T00:00:00.000Z", paidAt: null },
    { id: "k5", affiliateId: "a2", referralId: null, amount: "4.00", currency: "eur", state: "pending", createdAt: "2026-03-01T00:00:00.000Z", paidAt: null },
  ],
};

describe("applyImport", () => {
  let merchant: { id: string; paymentProvider: "STRIPE"; paymentKeyEnc: null };
  let standard: string;
  let vip: string;
  let existingId: string;

  beforeEach(async () => {
    await clearAll();
    const owner = await db.owner.create({ data: { email: `o-${crypto.randomUUID()}@example.com`, passwordHash: "x" } });
    const make = (slug: string) =>
      db.merchant.create({ data: { slug, ownerId: owner.id, name: slug, domain: `${crypto.randomUUID()}.example.com`, websiteUrl: "https://x.example.com" } });
    const m = await make("shop");
    const other = await make("other");
    merchant = { id: m.id, paymentProvider: "STRIPE", paymentKeyEnc: null };
    const program = (merchantId: string, name: string, holdingPeriodDays: number) =>
      db.program.create({
        data: { merchantId, slug: name.toLowerCase(), name, defaultCommissionRate: 20, commissionDurationType: "FOREVER", holdingPeriodDays },
      });
    standard = (await program(m.id, "Standard", 30)).id;
    vip = (await program(m.id, "VIP", 10)).id;
    const otherProgram = await program(other.id, "Standard", 30);
    await db.affiliate.create({
      data: { merchantId: other.id, programId: otherProgram.id, email: "x@example.com", links: { create: { code: "taken", isPrimary: true } } },
    });
    existingId = (
      await db.affiliate.create({
        data: { merchantId: m.id, programId: standard, email: "here@example.com", links: { create: { code: "here", isPrimary: true } } },
      })
    ).id;
  });

  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("previews without writing, naming the codes another product holds", async () => {
    const preview = await previewImport(merchant, "TOLT", FETCHED);
    expect(preview).toMatchObject({
      affiliates: 3,
      existingEmails: 1,
      codesTaken: ["taken"],
      codesInvalid: ["sarah_old"],
      referrals: 1,
      renewalsLinkable: 1,
      owed: [
        { currency: "usd", total: "30.00", count: 1 },
        { currency: "eur", total: "4.00", count: 1 },
      ],
      paid: [{ currency: "usd", total: "20.00", count: 2 }],
      alreadyImported: 0,
    });
    expect(await db.affiliate.count({ where: { merchantId: merchant.id } })).toBe(1);
  });

  it("writes affiliates, links, referrals and commissions as history, and tells nobody", async () => {
    const summary = await applyImport(merchant, "TOLT", FETCHED, { c1: vip, c2: standard });

    expect(summary).toEqual({
      createdAffiliateIds: expect.any(Array),
      affiliatesCreated: 2,
      affiliatesMatched: 1,
      codesTaken: ["taken"],
      codesInvalid: ["sarah_old"],
      referrals: 1,
      subscriptionsLinked: 1,
      commissionsOwed: 2,
      commissionsPaid: 2,
      commissionsSkipped: 0,
    });

    const sarah = await db.affiliate.findUniqueOrThrow({
      where: { merchantId_email: { merchantId: merchant.id, email: "sarah@example.com" } },
      include: { links: true },
    });
    expect(sarah.programId).toBe(vip);
    expect(sarah.payoutDetails).toBe("PayPal: s@paypal.test");
    expect(sarah.passwordHash).toBeNull();
    expect(sarah.links.map((l) => [l.code, l.isPrimary])).toEqual([["sarah", true]]);

    const tom = await db.affiliate.findUniqueOrThrow({
      where: { merchantId_email: { merchantId: merchant.id, email: "tom@example.com" } },
      include: { links: true },
    });
    expect(tom.payoutDetails).toBe("Wise: t@wise.test");
    expect(tom.links).toHaveLength(1);

    // Someone already here keeps their program and gains the old code.
    const here = await db.affiliate.findUniqueOrThrow({ where: { id: existingId }, include: { links: true } });
    expect(here.programId).toBe(standard);
    expect(here.links.map((l) => l.code).sort()).toEqual(["here", "here-old"]);

    const sub = await db.referredSubscription.findFirstOrThrow({ include: { click: true } });
    expect(sub.subscriptionRef).toBe("sub_1");
    expect(sub.click).toMatchObject({ affiliateId: sarah.id, programId: vip, referralToken: `import:tolt:${merchant.id}:referral:r1` });

    const owed = await db.commission.findFirstOrThrow({ where: { paymentRef: "import:tolt:k1" } });
    expect(owed).toMatchObject({ status: "PAYABLE", clickId: sub.clickId });
    const pending = await db.commission.findFirstOrThrow({ where: { paymentRef: "import:tolt:k5" } });
    expect(pending.status).toBe("PENDING");
    expect(pending.payableAt.toISOString()).toBe("2026-03-31T00:00:00.000Z");
    expect(await db.commission.count({ where: { paymentRef: "import:tolt:k4" } })).toBe(0);

    const [payout] = await db.payout.findMany({ include: { commissions: { select: { paymentRef: true } } } });
    expect(payout.amount.toFixed(2)).toBe("20.00");
    expect(payout.paidAt.toISOString()).toBe("2026-01-15T09:30:00.000Z");
    expect(payout.note).toBe("Paid in Tolt");
    expect(payout.commissions.map((c) => c.paymentRef).sort()).toEqual(["import:tolt:k2", "import:tolt:k3"]);

    expect((await db.merchant.findUniqueOrThrow({ where: { id: merchant.id } })).legacyReferralParam).toBe("ref");
    expect(await db.email.count()).toBe(0);
  });

  it("writes nothing twice when run again", async () => {
    await applyImport(merchant, "TOLT", FETCHED, { c1: vip, c2: standard });
    const counts = async () => ({
      affiliates: await db.affiliate.count(),
      links: await db.affiliateLink.count(),
      clicks: await db.click.count(),
      commissions: await db.commission.count(),
      payouts: await db.payout.count(),
      subscriptions: await db.referredSubscription.count(),
    });
    const before = await counts();

    const again = await applyImport(merchant, "TOLT", FETCHED, { c1: vip, c2: standard });

    expect(await counts()).toEqual(before);
    expect(again).toMatchObject({ affiliatesCreated: 0, affiliatesMatched: 3, commissionsOwed: 0, commissionsPaid: 0, commissionsSkipped: 4, subscriptionsLinked: 0 });
    expect((await previewImport(merchant, "TOLT", FETCHED)).alreadyImported).toBe(4);
  });

  it("puts an unmapped campaign's affiliates in the oldest program", async () => {
    await applyImport(merchant, "TOLT", FETCHED, {});
    const tom = await db.affiliate.findUniqueOrThrow({ where: { merchantId_email: { merchantId: merchant.id, email: "tom@example.com" } } });
    expect(tom.programId).toBe(standard);
  });

  it("keeps the same tool's referrals apart when two products import from it", async () => {
    const second = await db.merchant.create({
      data: { slug: "shop-2", ownerId: (await db.merchant.findUniqueOrThrow({ where: { id: merchant.id } })).ownerId, name: "Shop 2", domain: `${crypto.randomUUID()}.example.com`, websiteUrl: "https://y.example.com" },
    });
    await db.program.create({ data: { merchantId: second.id, slug: "p", name: "P", defaultCommissionRate: 20, commissionDurationType: "FOREVER" } });
    const solo: FetchedProgram = { ...FETCHED, affiliates: FETCHED.affiliates.map((a) => ({ ...a, codes: [] })) };

    await applyImport(merchant, "TOLT", solo, {});
    await applyImport({ ...merchant, id: second.id }, "TOLT", solo, {});

    const subs = await db.referredSubscription.findMany({ include: { click: { include: { affiliate: true } } } });
    expect(subs.map((s) => [s.merchantId, s.click.affiliate.merchantId]).sort()).toEqual(
      [
        [merchant.id, merchant.id],
        [second.id, second.id],
      ].sort()
    );
  });
});
