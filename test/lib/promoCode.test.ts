// Destructive: clears Commission / Click / AffiliatePromoCode / Affiliate /
// Program / Merchant / Owner. Runs against the scratch DATABASE_URL that
// test/setup.ts enforces, never the dev one.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type Stripe from "stripe";

import { db } from "@/lib/db";

// Finding a code by its text, creating one, and turning one off.
const stripeStub = vi.hoisted(() => ({
  promotionCodes: {
    list: vi.fn(async (_params: unknown): Promise<unknown> => ({ data: [] })),
    create: vi.fn(async (params: { code: string }, _opts?: unknown): Promise<unknown> => ({ id: `promo_${params.code}`, code: params.code })),
    update: vi.fn(async (_id: string, _params: unknown): Promise<unknown> => ({})),
  },
}));
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe")>("@/lib/stripe");
  return { ...actual, stripeClientFor: () => stripeStub as unknown as Stripe };
});

import {
  addPromoCode,
  claimPromoCode,
  issuePromoCode,
  listPromoCodes,
  listPromoCodesWithStats,
  promoCodeOffer,
  turnOffPromoCode,
  MAX_PROMO_CODES_PER_AFFILIATE,
} from "@/lib/promoCode";
import { listAffiliateCommissions, listAffiliatesForMerchant } from "@/lib/affiliate";
import { listCommissions } from "@/lib/commission";
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
  let programId: string;
  let aliceId: string;
  let bobId: string;

  beforeEach(async () => {
    await clearAll();
    stripeStub.promotionCodes.list.mockReset();
    stripeStub.promotionCodes.list.mockResolvedValue({ data: [] });
    stripeStub.promotionCodes.create.mockClear();
    stripeStub.promotionCodes.update.mockReset();
    stripeStub.promotionCodes.update.mockResolvedValue({});

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
    programId = program.id;
    const affiliate = (email: string) =>
      db.affiliate.create({
        data: {
          merchantId,
          programId: program.id,
          email,
          links: { create: { code: `${email.split("@")[0]}-${crypto.randomUUID().slice(0, 8)}`, isPrimary: true } },
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
    expect(row.issued).toBe(false);
    expect(await listPromoCodes(aliceId)).toEqual([{ id: row.id, code: "ALICE20", discountLabel: null }]);
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

  it("turns off a linked code without touching Stripe, and keeps the sales it brought", async () => {
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

    expect(await turnOffPromoCode(ownerId, merchantId, aliceId, code.id)).toEqual({ ok: true });

    expect(stripeStub.promotionCodes.update).not.toHaveBeenCalled();
    expect((await db.affiliatePromoCode.findUniqueOrThrow({ where: { id: code.id } })).disabledAt).not.toBeNull();
    expect(await listPromoCodes(aliceId)).toEqual([]);
    expect(await db.click.findUniqueOrThrow({ where: { id: sale.id } })).toMatchObject({ promoCodeId: code.id });
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

  it("names the code, not a click or a link, on a code sale's commission", async () => {
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
    await db.commission.create({
      data: {
        affiliateId: aliceId,
        clickId: sale.id,
        stripePaymentRef: "pi_1",
        amount: 10,
        currency: "usd",
        payableAt: new Date(),
      },
    });
    const owners = () =>
      listCommissions(ownerId, merchantId, { status: null, affiliateId: null, currency: null, query: null }, { page: 1, pageSize: 25 });

    expect((await listAffiliateCommissions(aliceId, { page: 1, pageSize: 25 })).rows[0]).toMatchObject({
      linkCode: null,
      promoCode: "ALICE20",
    });
    expect((await owners()).rows[0].promoCode).toEqual({ code: "ALICE20" });

    // Turned off since: still named, it is still the code that made the sale.
    await turnOffPromoCode(ownerId, merchantId, aliceId, code.id);
    expect((await owners()).rows[0].promoCode).toEqual({ code: "ALICE20" });
  });

  it("counts each code's sales and earnings the way a link's are", async () => {
    const first = await db.affiliatePromoCode.create({
      data: { merchantId, affiliateId: aliceId, stripePromotionCodeId: "promo_0", code: "ALICE20", createdAt: new Date(Date.now() - 1000) },
    });
    const second = await db.affiliatePromoCode.create({
      data: { merchantId, affiliateId: aliceId, stripePromotionCodeId: "promo_1", code: "ALICE50" },
    });
    const sale = async (codeId: string, ref: string, amount: number, currency: string, status: "PENDING" | "VOIDED") => {
      const click = await db.click.create({
        data: { affiliateId: aliceId, referralToken: crypto.randomUUID(), expiresAt: new Date(), promoCodeId: codeId, promoCheckoutSessionId: `cs_${ref}` },
      });
      await db.commission.create({
        data: { affiliateId: aliceId, clickId: click.id, stripePaymentRef: ref, amount, currency, status, payableAt: new Date() },
      });
    };
    await sale(first.id, "pi_1", 10, "usd", "PENDING");
    await sale(first.id, "pi_2", 5, "eur", "PENDING");
    // Refunded: neither a sale nor earned.
    await sale(first.id, "pi_3", 99, "usd", "VOIDED");

    expect(await listPromoCodesWithStats(aliceId)).toEqual([
      {
        id: first.id,
        code: "ALICE20",
        discountLabel: null,
        issued: false,
        off: false,
        conversions: 2,
        earned: [
          { currency: "eur", total: "5.00" },
          { currency: "usd", total: "10.00" },
        ],
      },
      { id: second.id, code: "ALICE50", discountLabel: null, issued: false, off: false, conversions: 0, earned: [] },
    ]);

    // Turned off: still listed with what it earned, after the live ones.
    await turnOffPromoCode(ownerId, merchantId, aliceId, first.id);
    expect((await listPromoCodesWithStats(aliceId)).map((c) => [c.code, c.off, c.conversions])).toEqual([
      ["ALICE50", false, 0],
      ["ALICE20", true, 2],
    ]);
  });

  describe("issued from the program's discount", () => {
    const giveDiscount = () =>
      db.program.update({ where: { id: programId }, data: { stripeCouponId: "coupon_20", discountLabel: "20% off for 3 months" } });

    beforeEach(giveDiscount);

    it("creates the affiliate's code in Stripe from the coupon, for new customers only", async () => {
      expect(await claimPromoCode(aliceId, " alice20 ")).toEqual({ ok: true });

      expect(stripeStub.promotionCodes.list).toHaveBeenCalledWith({ code: "ALICE20", active: true, limit: 2 });
      expect(stripeStub.promotionCodes.create).toHaveBeenCalledWith(
        {
          promotion: { type: "coupon", coupon: "coupon_20" },
          code: "ALICE20",
          restrictions: { first_time_transaction: true },
          metadata: { supaffi_affiliate_id: aliceId },
        },
        { idempotencyKey: `supaffi-promo:${aliceId}:0:ALICE20` }
      );
      const row = await db.affiliatePromoCode.findFirstOrThrow();
      expect(row).toMatchObject({
        affiliateId: aliceId,
        stripePromotionCodeId: "promo_ALICE20",
        code: "ALICE20",
        issued: true,
        discountLabel: "20% off for 3 months",
        disabledAt: null,
      });
      expect(await promoCodeOffer(aliceId)).toEqual({ kind: "code", code: "ALICE20", discountLabel: "20% off for 3 months" });
    });

    it("offers a claim, named after the affiliate's link, until there is a code", async () => {
      const offer = await promoCodeOffer(aliceId);
      expect(offer).toEqual({ kind: "claim", suggested: expect.stringMatching(/^ALICE[A-Z0-9]+20$/), discountLabel: "20% off for 3 months" });
    });

    it("offers nothing when the program has no discount", async () => {
      await db.program.update({ where: { id: programId }, data: { stripeCouponId: null, discountLabel: null } });

      expect(await promoCodeOffer(aliceId)).toBeNull();
      expect(await claimPromoCode(aliceId, "ALICE20")).toEqual({ ok: false, error: "This program has no discount" });
      expect(stripeStub.promotionCodes.create).not.toHaveBeenCalled();
    });

    it("refuses a name Stripe already has, without creating anything", async () => {
      found({ id: "promo_other", code: "ALICE20" });

      expect(await claimPromoCode(aliceId, "ALICE20")).toEqual({ ok: false, error: "That code is taken" });
      expect(stripeStub.promotionCodes.create).not.toHaveBeenCalled();
    });

    it("refuses a name that is not 3 to 20 letters or numbers", async () => {
      expect(await claimPromoCode(aliceId, "A1")).toEqual({ ok: false, error: "Use 3 to 20 letters or numbers" });
      expect(await claimPromoCode(aliceId, "ALICE-20")).toEqual({ ok: false, error: "Use 3 to 20 letters or numbers" });
      expect(stripeStub.promotionCodes.list).not.toHaveBeenCalled();
    });

    it("gives one live code per affiliate", async () => {
      await claimPromoCode(aliceId, "ALICE20");

      expect(await claimPromoCode(aliceId, "ALICE30")).toEqual({ ok: false, error: "There is already a code" });
      expect(stripeStub.promotionCodes.create).toHaveBeenCalledTimes(1);
    });

    it("says the key needs replacing, whether it cannot read codes or only cannot create them", async () => {
      const invalid = () => Object.assign(new Error("no"), { type: "StripeInvalidRequestError", statusCode: 400 });
      stripeStub.promotionCodes.list.mockRejectedValueOnce(invalid());
      expect(await claimPromoCode(aliceId, "ALICE20")).toEqual({
        ok: false,
        error: "Your Stripe key can't create promo codes.",
        keyLacksPermission: true,
      });

      stripeStub.promotionCodes.create.mockRejectedValueOnce(invalid());
      expect(await claimPromoCode(aliceId, "ALICE20")).toMatchObject({ ok: false, keyLacksPermission: true });
      expect(await db.affiliatePromoCode.count()).toBe(0);
    });

    it("lets the owner make it for the affiliate, and only for their own", async () => {
      const other = await db.owner.create({ data: { email: `other-${crypto.randomUUID()}@example.com`, passwordHash: "x" } });
      expect(await issuePromoCode(other.id, merchantId, aliceId, "ALICE20")).toEqual({ ok: false, error: "Affiliate not found" });

      expect(await issuePromoCode(ownerId, merchantId, aliceId, "ALICE20")).toEqual({ ok: true });
      expect((await db.affiliatePromoCode.findFirstOrThrow()).issued).toBe(true);
    });

    it("turns an issued code off in Stripe, then lets the affiliate claim a new one", async () => {
      await claimPromoCode(aliceId, "ALICE20");
      const code = await db.affiliatePromoCode.findFirstOrThrow();

      expect(await turnOffPromoCode(ownerId, merchantId, aliceId, code.id)).toEqual({ ok: true });

      expect(stripeStub.promotionCodes.update).toHaveBeenCalledWith("promo_ALICE20", { active: false });
      expect(await promoCodeOffer(aliceId)).toMatchObject({ kind: "claim" });
      expect(await claimPromoCode(aliceId, "ALICE21")).toEqual({ ok: true });
      // A new idempotency key: the first code counts.
      expect(stripeStub.promotionCodes.create).toHaveBeenLastCalledWith(expect.anything(), {
        idempotencyKey: `supaffi-promo:${aliceId}:1:ALICE21`,
      });
    });

    it("never brings a turned off code's text back", async () => {
      const first = await promoCodeOffer(aliceId);
      if (first?.kind !== "claim") throw new Error("expected a claim");
      await claimPromoCode(aliceId, first.suggested);
      const code = await db.affiliatePromoCode.findFirstOrThrow();
      await turnOffPromoCode(ownerId, merchantId, aliceId, code.id);

      expect(await promoCodeOffer(aliceId)).toMatchObject({ kind: "claim", suggested: first.suggested.slice(0, -"20".length) });
      expect(await claimPromoCode(aliceId, first.suggested.toLowerCase())).toEqual({ ok: false, error: "That code is taken" });
    });

    it("leaves an issued code on when Stripe cannot turn it off", async () => {
      await claimPromoCode(aliceId, "ALICE20");
      const code = await db.affiliatePromoCode.findFirstOrThrow();
      stripeStub.promotionCodes.update.mockRejectedValueOnce(Object.assign(new Error("down"), { type: "StripeConnectionError" }));

      expect(await turnOffPromoCode(ownerId, merchantId, aliceId, code.id)).toEqual({
        ok: false,
        error: "Stripe could not be reached. Try again.",
      });
      expect((await db.affiliatePromoCode.findFirstOrThrow()).disabledAt).toBeNull();
    });
  });
});
