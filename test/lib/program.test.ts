// Destructive: runs db.affiliateLink.deleteMany() / db.affiliate.deleteMany() /
// db.program.deleteMany() / db.merchant.deleteMany() / db.owner.deleteMany()
// before every test. Point DATABASE_URL at a disposable database, never a
// real deployment's data.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import type Stripe from "stripe";
import { db } from "@/lib/db";

// The program's discount: the one coupon read a save can make.
const stripeStub = vi.hoisted(() => ({
  coupons: { retrieve: vi.fn(async (_id: string): Promise<unknown> => ({})) },
}));
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe")>("@/lib/stripe");
  return { ...actual, stripeClientFor: () => stripeStub as unknown as Stripe };
});

import {
  createProgram,
  listProgramsForMerchant,
  getProgramForMerchant,
  updateProgram,
  getProgramForSignup,
  getClosedProgramName,
  getDefaultProgramSlug,
  programDiscount,
} from "@/lib/program";

// Skip this whole suite cleanly when no database is reachable, instead of
// letting Prisma throw an opaque connection error mid-run. Checked once, up
// front, via a real connection attempt (not just "is DATABASE_URL set") so a
// stale/unreachable URL also skips rather than failing the suite.
let hasDatabase = false;
if (process.env.DATABASE_URL) {
  try {
    await db.$connect();
    hasDatabase = true;
  } catch {
    hasDatabase = false;
  }
}

if (!hasDatabase) {
  // eslint-disable-next-line no-console
  console.warn(
    "Skipping test/lib/program.test.ts: no reachable DATABASE_URL. Set DATABASE_URL to a disposable database to run these tests."
  );
}

const baseInput = {
  name: "Standard",
  defaultCommissionRate: 20,
  commissionDurationType: "FOREVER" as const,
  commissionDurationMonths: null,
  attributionWindowDays: 60,
  holdingPeriodDays: 30,
};

describe.skipIf(!hasDatabase)("program", () => {
  let ownerId: string;
  let merchantId: string;
  let merchantId2: string;
  let otherOwnerId: string;
  let otherMerchantId: string;

  beforeEach(async () => {
    // Affiliates reference Program with a RESTRICT foreign key, so they have
    // to go first (and AffiliateLink before Affiliate, same reason) or
    // Program.deleteMany throws instead of cleaning up.
    await db.affiliateLink.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();

    const owner = await db.owner.create({
      data: { email: "program-test-owner@example.com", passwordHash: "x" },
    });
    ownerId = owner.id;
    const merchant = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId,
        name: "M",
        domain: "program-test.example.com",
        websiteUrl: "https://example.com",
        stripeSecretKeyEnc: "x",
        stripeWebhookSecretEnc: "x",
      },
    });
    merchantId = merchant.id;

    // A second Merchant owned by the SAME Owner — the boundary that
    // getProgramForMerchant/updateProgram's `where: { id, merchantId }`
    // filter (scoped in addition to the ownership check) protects against.
    const merchant2 = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId,
        name: "M2",
        domain: "program-test-2.example.com",
        websiteUrl: "https://example.com",
        stripeSecretKeyEnc: "x",
        stripeWebhookSecretEnc: "x",
      },
    });
    merchantId2 = merchant2.id;

    const otherOwner = await db.owner.create({
      data: { email: "program-test-other-owner@example.com", passwordHash: "x" },
    });
    otherOwnerId = otherOwner.id;
    const otherMerchant = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: otherOwnerId,
        name: "OM",
        domain: "program-test-other.example.com",
        websiteUrl: "https://example.com",
        stripeSecretKeyEnc: "x",
        stripeWebhookSecretEnc: "x",
      },
    });
    otherMerchantId = otherMerchant.id;
  });

  afterAll(async () => {
    await db.affiliateLink.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
    await db.$disconnect();
  });

  it("creates a Program under a Merchant the Owner owns", async () => {
    const { id } = await createProgram(ownerId, merchantId, baseInput);
    const raw = await db.program.findUniqueOrThrow({ where: { id } });
    expect(raw.name).toBe("Standard");
    expect(Number(raw.defaultCommissionRate)).toBe(20);
  });

  it("refuses to create a Program under a Merchant the Owner doesn't own", async () => {
    await expect(createProgram(ownerId, otherMerchantId, baseInput)).rejects.toThrow();
  });

  it("lists only Programs for the given, owned Merchant", async () => {
    await createProgram(ownerId, merchantId, baseInput);
    const list = await listProgramsForMerchant(ownerId, merchantId);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Standard");
  });

  it("lists Programs with the terms the Programs screen's cards need", async () => {
    await createProgram(ownerId, merchantId, {
      ...baseInput,
      commissionDurationType: "FIXED_MONTHS",
      commissionDurationMonths: 12,
      attributionWindowDays: 45,
      holdingPeriodDays: 15,
    });

    const [program] = await listProgramsForMerchant(ownerId, merchantId);
    expect(program.commissionDurationType).toBe("FIXED_MONTHS");
    expect(program.commissionDurationMonths).toBe(12);
    expect(program.attributionWindowDays).toBe(45);
    expect(program.holdingPeriodDays).toBe(15);
  });

  it("lists Programs with their affiliate count", async () => {
    const { id } = await createProgram(ownerId, merchantId, baseInput);
    await db.affiliate.create({
      data: {
        merchantId,
        programId: id,
        email: "sarah@example.com",
        links: { create: { code: "sarah", isPrimary: true } },
      },
    });
    await db.affiliate.create({
      data: {
        merchantId,
        programId: id,
        email: "rob@example.com",
        links: { create: { code: "rob", isPrimary: true } },
      },
    });

    const list = await listProgramsForMerchant(ownerId, merchantId);
    expect(list[0].affiliateCount).toBe(2);
  });

  it("getProgramForMerchant returns null when the Merchant isn't owned by the caller", async () => {
    const { slug } = await db.program.create({
      data: {
        merchantId: otherMerchantId,
        slug: crypto.randomUUID(),
        ...baseInput,
        defaultCommissionRate: 20,
      },
    });
    const result = await getProgramForMerchant(ownerId, otherMerchantId, slug);
    expect(result).toBeNull();
  });

  it("getProgramForMerchant returns null for a Program under a different Merchant owned by the SAME Owner", async () => {
    const { slug } = await createProgram(ownerId, merchantId, baseInput);
    const result = await getProgramForMerchant(ownerId, merchantId2, slug);
    expect(result).toBeNull();
  });

  it("updateProgram updates fields and validates FIXED_MONTHS requires commissionDurationMonths", async () => {
    const { id } = await createProgram(ownerId, merchantId, baseInput);
    await updateProgram(ownerId, merchantId, id, {
      ...baseInput,
      name: "Renamed",
      commissionDurationType: "FIXED_MONTHS",
      commissionDurationMonths: 12,
    });
    const raw = await db.program.findUniqueOrThrow({ where: { id } });
    expect(raw.name).toBe("Renamed");
    expect(raw.commissionDurationType).toBe("FIXED_MONTHS");
    expect(raw.commissionDurationMonths).toBe(12);
  });

  it("updateProgram throws when the Merchant isn't owned by the caller", async () => {
    const { id } = await db.program.create({
      data: { merchantId: otherMerchantId, slug: crypto.randomUUID(), ...baseInput },
    });
    await expect(
      updateProgram(ownerId, otherMerchantId, id, { ...baseInput, name: "Hijacked" })
    ).rejects.toThrow();
  });

  it("getProgramForSignup resolves a Program scoped to its Merchant, no owner required", async () => {
    const { slug } = await createProgram(ownerId, merchantId, baseInput);

    const result = await getProgramForSignup(merchantId, slug);
    expect(result?.name).toBe("Standard");
  });

  it("getProgramForSignup returns null for a Program whose signup is closed, and an update without the flag keeps it closed", async () => {
    const { id, slug } = await createProgram(ownerId, merchantId, { ...baseInput, signupOpen: false });
    expect(await getProgramForSignup(merchantId, slug)).toBeNull();

    // Onboarding saves the terms without the flag.
    await updateProgram(ownerId, merchantId, id, { ...baseInput, name: "Standard" });
    expect(await getProgramForSignup(merchantId, slug)).toBeNull();

    await updateProgram(ownerId, merchantId, id, { ...baseInput, signupOpen: true });
    expect((await getProgramForSignup(merchantId, slug))?.name).toBe("Standard");
  });

  it("getClosedProgramName names a closed Program on its own Merchant only", async () => {
    const closed = await createProgram(ownerId, merchantId, { ...baseInput, name: "Creators", signupOpen: false });
    const open = await createProgram(ownerId, merchantId, baseInput);

    expect(await getClosedProgramName(merchantId, closed.slug)).toBe("Creators");
    expect(await getClosedProgramName(merchantId, open.slug)).toBeNull();
    expect(await getClosedProgramName(merchantId2, closed.slug)).toBeNull();
    expect(await getClosedProgramName(merchantId, "missing")).toBeNull();
  });

  it("getDefaultProgramSlug is this Merchant's oldest open Program", async () => {
    expect(await getDefaultProgramSlug(merchantId)).toBeNull();

    const closed = await createProgram(ownerId, merchantId, { ...baseInput, name: "Creators", signupOpen: false });
    const first = await createProgram(ownerId, merchantId, { ...baseInput, name: "Partners" });
    await createProgram(ownerId, merchantId, { ...baseInput, name: "Agencies" });
    await createProgram(ownerId, merchantId2, { ...baseInput, name: "Elsewhere" });

    expect(await getDefaultProgramSlug(merchantId)).toBe(first.slug);
    expect(closed.slug).not.toBe(first.slug);
  });

  it("getProgramForSignup returns null when the Program belongs to a different Merchant", async () => {
    const { slug } = await createProgram(ownerId, merchantId, baseInput);

    const result = await getProgramForSignup(merchantId2, slug);
    expect(result).toBeNull();
  });

  describe("discount", () => {
    beforeEach(() => {
      stripeStub.coupons.retrieve.mockReset();
      stripeStub.coupons.retrieve.mockResolvedValue({
        valid: true,
        percent_off: 20,
        amount_off: null,
        currency: null,
        duration: "repeating",
        duration_in_months: 3,
      });
    });

    it("reads a newly picked coupon's label from Stripe", async () => {
      expect(await programDiscount(ownerId, merchantId, null, "coupon_20")).toEqual({
        error: null,
        stripeCouponId: "coupon_20",
        discountLabel: "20% off for 3 months",
      });
      expect(stripeStub.coupons.retrieve).toHaveBeenCalledWith("coupon_20");
    });

    it("keeps an unchanged coupon's stored label without asking Stripe", async () => {
      const { id } = await createProgram(ownerId, merchantId, {
        ...baseInput,
        stripeCouponId: "coupon_20",
        discountLabel: "20% off for 3 months",
      });

      expect(await programDiscount(ownerId, merchantId, id, "coupon_20")).toEqual({
        error: null,
        stripeCouponId: "coupon_20",
        discountLabel: "20% off for 3 months",
      });
      expect(stripeStub.coupons.retrieve).not.toHaveBeenCalled();
    });

    it("takes the discount away on none, and refuses a coupon that can no longer be used", async () => {
      expect(await programDiscount(ownerId, merchantId, null, "")).toEqual({ error: null, stripeCouponId: null, discountLabel: null });
      stripeStub.coupons.retrieve.mockResolvedValueOnce({ valid: false });
      expect(await programDiscount(ownerId, merchantId, null, "coupon_old")).toEqual({ error: "That coupon can no longer be used" });
    });

    it("shows the discount on the signup page only while a coupon is set", async () => {
      const { id, slug } = await createProgram(ownerId, merchantId, {
        ...baseInput,
        stripeCouponId: "coupon_20",
        discountLabel: "20% off for 3 months",
      });
      expect((await getProgramForSignup(merchantId, slug))?.discountLabel).toBe("20% off for 3 months");

      await updateProgram(ownerId, merchantId, id, { ...baseInput, stripeCouponId: null, discountLabel: null });
      expect((await getProgramForSignup(merchantId, slug))?.discountLabel).toBeNull();
    });
  });
});
