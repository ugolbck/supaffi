// Destructive: clears Commission / Click / AffiliatePromoCode / Affiliate /
// Program / Merchant / Owner. Runs against the scratch DATABASE_URL that
// test/setup.ts enforces, never the dev one.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type Stripe from "stripe";

import { db } from "@/lib/db";

// Adding a code makes the one Stripe call there is: finding the code by its text.
const stripeStub = vi.hoisted(() => ({
  promotionCodes: {
    list: vi.fn(async (_params: unknown): Promise<unknown> => ({ data: [] })),
  },
}));
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe")>("@/lib/stripe");
  return { ...actual, stripeClientFor: () => stripeStub as unknown as Stripe };
});

import { addPromoCode, listPromoCodes, removePromoCode, MAX_PROMO_CODES_PER_AFFILIATE } from "@/lib/promoCode";
import { listAffiliatesForMerchant } from "@/lib/affiliate";
import { getTrackingStatus } from "@/lib/tracking";

async function clearAll() {
  await db.commission.deleteMany();
  await db.referredSubscription.deleteMany();
  await db.click.deleteMany();
  await db.affiliatePromoCode.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

function found(...codes: { id: string; code: string }[]) {
  stripeStub.promotionCodes.list.mockResolvedValueOnce({ data: codes });
}

describe("promo codes", () => {
  let ownerId: string;
  let merchantId: string;
  let aliceId: string;
  let bobId: string;

  beforeEach(async () => {
    await clearAll();
    stripeStub.promotionCodes.list.mockReset();
    stripeStub.promotionCodes.list.mockResolvedValue({ data: [] });

    const owner = await db.owner.create({ data: { email: `owner-${crypto.randomUUID()}@example.com`, passwordHash: "x" } });
    ownerId = owner.id;
    const merchant = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId,
        name: "InstantGradient",
        domain: `${crypto.randomUUID()}.example.com`,
        websiteUrl: "https://instantgradient.com",
        stripeSecretKeyEnc: "x",
      },
    });
    merchantId = merchant.id;
    const program = await db.program.create({
      data: {
        slug: crypto.randomUUID(),
        merchantId,
        name: "Standard",
        defaultCommissionRate: 20,
        commissionDurationType: "FOREVER",
        attributionWindowDays: 60,
        holdingPeriodDays: 30,
      },
    });
    const affiliate = (email: string) =>
      db.affiliate.create({
        data: {
          merchantId,
          programId: program.id,
          email,
          links: { create: { code: crypto.randomUUID(), isPrimary: true } },
        },
      });
    aliceId = (await affiliate("alice@example.com")).id;
    bobId = (await affiliate("bob@example.com")).id;
  });

  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("stores the code Stripe finds by its text, under Stripe's id and spelling", async () => {
    found({ id: "promo_1", code: "ALICE20" });

    expect(await addPromoCode(ownerId, merchantId, aliceId, "  alice20 ")).toEqual({ ok: true });

    expect(stripeStub.promotionCodes.list).toHaveBeenCalledWith({ code: "alice20", active: true, limit: 2 });
    const row = await db.affiliatePromoCode.findFirstOrThrow();
    expect(row).toMatchObject({ merchantId, affiliateId: aliceId, stripePromotionCodeId: "promo_1", code: "ALICE20" });
    expect(await listPromoCodes(aliceId)).toEqual([{ id: row.id, code: "ALICE20" }]);
  });

  it("refuses a code Stripe has no active match for", async () => {
    expect(await addPromoCode(ownerId, merchantId, aliceId, "NOPE")).toEqual({
      ok: false,
      error: "No active promotion code with that text in Stripe",
    });
    expect(await db.affiliatePromoCode.count()).toBe(0);
  });

  it("refuses text shared by more than one code", async () => {
    found({ id: "promo_1", code: "VIP" }, { id: "promo_2", code: "VIP" });

    const result = await addPromoCode(ownerId, merchantId, aliceId, "VIP");

    expect(result).toEqual({ ok: false, error: "More than one promotion code in Stripe uses that text" });
  });

  it("refuses a code another affiliate already has", async () => {
    found({ id: "promo_1", code: "ALICE20" });
    await addPromoCode(ownerId, merchantId, aliceId, "ALICE20");
    found({ id: "promo_1", code: "ALICE20" });

    const result = await addPromoCode(ownerId, merchantId, bobId, "ALICE20");

    expect(result).toEqual({ ok: false, error: "That code already belongs to an affiliate" });
    expect(await db.affiliatePromoCode.count()).toBe(1);
  });

  it("sends the owner to replace a key that cannot read promotion codes", async () => {
    stripeStub.promotionCodes.list.mockRejectedValueOnce(
      Object.assign(new Error("no"), { type: "StripePermissionError", statusCode: 403 })
    );

    const result = await addPromoCode(ownerId, merchantId, aliceId, "ALICE20");

    expect(result).toEqual({ ok: false, error: "Your Stripe key can't read promotion codes.", keyLacksPermission: true });
  });

  it("asks to try again when Stripe is down", async () => {
    stripeStub.promotionCodes.list.mockRejectedValueOnce(Object.assign(new Error("down"), { type: "StripeConnectionError" }));

    expect(await addPromoCode(ownerId, merchantId, aliceId, "ALICE20")).toEqual({
      ok: false,
      error: "Stripe could not be reached. Try again.",
    });
  });

  it("refuses an empty code without asking Stripe", async () => {
    expect(await addPromoCode(ownerId, merchantId, aliceId, "   ")).toEqual({ ok: false, error: "Enter a code" });
    expect(stripeStub.promotionCodes.list).not.toHaveBeenCalled();
  });

  it("refuses another owner's affiliate", async () => {
    const other = await db.owner.create({ data: { email: `other-${crypto.randomUUID()}@example.com`, passwordHash: "x" } });

    expect(await addPromoCode(other.id, merchantId, aliceId, "ALICE20")).toEqual({ ok: false, error: "Affiliate not found" });
    expect(stripeStub.promotionCodes.list).not.toHaveBeenCalled();
  });

  it(`stops at ${MAX_PROMO_CODES_PER_AFFILIATE} codes per affiliate`, async () => {
    await db.affiliatePromoCode.createMany({
      data: Array.from({ length: MAX_PROMO_CODES_PER_AFFILIATE }, (_, i) => ({
        merchantId,
        affiliateId: aliceId,
        stripePromotionCodeId: `promo_${i}`,
        code: `CODE${i}`,
      })),
    });

    const result = await addPromoCode(ownerId, merchantId, aliceId, "ONEMORE");

    expect(result.ok).toBe(false);
    expect(stripeStub.promotionCodes.list).not.toHaveBeenCalled();
  });

  it("removes a code and keeps the sales it brought", async () => {
    const code = await db.affiliatePromoCode.create({
      data: { merchantId, affiliateId: aliceId, stripePromotionCodeId: "promo_1", code: "ALICE20" },
    });
    const sale = await db.click.create({
      data: {
        affiliateId: aliceId,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(),
        promoCodeId: code.id,
        promoCheckoutSessionId: "cs_1",
      },
    });

    await removePromoCode(ownerId, merchantId, aliceId, code.id);

    expect(await db.affiliatePromoCode.count()).toBe(0);
    expect(await db.click.findUniqueOrThrow({ where: { id: sale.id } })).toMatchObject({
      promoCodeId: null,
      promoCheckoutSessionId: "cs_1",
    });
  });

  it("leaves a code sale's click out of click counts and tracking", async () => {
    await db.click.create({
      data: { affiliateId: aliceId, referralToken: crypto.randomUUID(), expiresAt: new Date(), promoCheckoutSessionId: "cs_1" },
    });

    const { rows } = await listAffiliatesForMerchant(
      ownerId,
      merchantId,
      { programId: null, query: null },
      { page: 1, pageSize: 25 }
    );
    expect(rows.find((r) => r.id === aliceId)?.clicks).toBe(0);
    expect(await getTrackingStatus(merchantId)).toBe("not-started");
  });
});
