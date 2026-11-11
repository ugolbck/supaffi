import { db } from "@/lib/db";
import type { CommissionDurationType } from "@prisma/client";
import { uniqueSlug } from "@/lib/slug";
import { stripeClientFor } from "@/lib/payments/stripe/client";
import { couponById, listCoupons, type CouponList } from "@/lib/coupon";

export type ProgramInput = {
  name: string;
  defaultCommissionRate: number;
  commissionDurationType: CommissionDurationType;
  commissionDurationMonths: number | null;
  attributionWindowDays: number;
  holdingPeriodDays: number;
  /** Left out by onboarding, which keeps the stored value (open by default). */
  signupOpen?: boolean;
  /** Left out by onboarding too. Null takes the discount away. See `programDiscount`. */
  discountRef?: string | null;
  discountLabel?: string | null;
};

/** The coupons a program's form offers. Null when Stripe is not connected yet. */
export async function couponsForProgramForm(ownerId: string, merchantId: string): Promise<CouponList | null> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { paymentProvider: true, paymentKeyEnc: true },
  });
  // Promo codes are built on Stripe coupons, so other providers have no
  // discount to pick yet.
  if (merchant?.paymentProvider !== "STRIPE" || !merchant.paymentKeyEnc) return null;
  return listCoupons(stripeClientFor(merchant));
}

/**
 * The coupon a program's form picked, with what it gives a customer, ready to
 * store. An unchanged pick keeps the label already stored, so saving the rest
 * of the terms never depends on Stripe answering.
 */
export async function programDiscount(
  ownerId: string,
  merchantId: string,
  programId: string | null,
  couponId: string
): Promise<{ error: string } | { error: null; discountRef: string | null; discountLabel: string | null }> {
  if (couponId === "") return { error: null, discountRef: null, discountLabel: null };
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: {
      paymentProvider: true,
      paymentKeyEnc: true,
      programs: { where: { id: programId ?? "" }, select: { discountRef: true, discountLabel: true } },
    },
  });
  if (!merchant) throw new Error("Merchant not found");
  const current = merchant.programs[0];
  if (current?.discountRef === couponId) {
    return { error: null, discountRef: couponId, discountLabel: current.discountLabel };
  }
  if (merchant.paymentProvider !== "STRIPE") return { error: "Promo codes need Stripe" };
  if (!merchant.paymentKeyEnc) return { error: "Connect Stripe first" };
  const coupon = await couponById(stripeClientFor(merchant), couponId);
  if (!coupon.ok) return { error: coupon.error };
  return { error: null, discountRef: couponId, discountLabel: coupon.label };
}

async function assertMerchantOwnership(ownerId: string, merchantId: string): Promise<void> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { id: true },
  });
  if (!merchant) {
    throw new Error("Merchant not found");
  }
}

export async function createProgram(
  ownerId: string,
  merchantId: string,
  input: ProgramInput
): Promise<{ id: string; slug: string }> {
  await assertMerchantOwnership(ownerId, merchantId);

  const slug = await uniqueSlug(input.name, "program", async (candidate) =>
    Boolean(
      await db.program.findFirst({
        where: { merchantId, slug: candidate },
        select: { id: true },
      })
    )
  );

  return db.program.create({
    data: { merchantId, slug, ...input },
    select: { id: true, slug: true },
  });
}

export async function listProgramsForMerchant(
  ownerId: string,
  merchantId: string
): Promise<
  {
    id: string;
    slug: string;
    name: string;
    defaultCommissionRate: unknown;
    commissionDurationType: CommissionDurationType;
    commissionDurationMonths: number | null;
    attributionWindowDays: number;
    holdingPeriodDays: number;
    signupOpen: boolean;
    discountRef: string | null;
    discountLabel: string | null;
    affiliateCount: number;
  }[]
> {
  await assertMerchantOwnership(ownerId, merchantId);

  const programs = await db.program.findMany({
    where: { merchantId },
    select: {
      id: true,
      slug: true,
      name: true,
      defaultCommissionRate: true,
      commissionDurationType: true,
      commissionDurationMonths: true,
      attributionWindowDays: true,
      holdingPeriodDays: true,
      signupOpen: true,
      discountRef: true,
      discountLabel: true,
      _count: { select: { affiliates: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // The product overview's Programs card reads this to say how many
  // affiliates each program has without a second round trip per row. The
  // Programs screen's cards read the duration/window/holding fields too, so
  // that grid doesn't need a second query per card either.
  return programs.map(({ _count, ...program }) => ({
    ...program,
    affiliateCount: _count.affiliates,
  }));
}

export async function getProgramForMerchant(
  ownerId: string,
  merchantId: string,
  programSlug: string
): Promise<{
  id: string;
  slug: string;
  name: string;
  defaultCommissionRate: unknown;
  commissionDurationType: CommissionDurationType;
  commissionDurationMonths: number | null;
  attributionWindowDays: number;
  holdingPeriodDays: number;
} | null> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { id: true },
  });
  if (!merchant) return null;

  return db.program.findFirst({
    where: { slug: programSlug, merchantId },
    select: {
      id: true,
      slug: true,
      name: true,
      defaultCommissionRate: true,
      commissionDurationType: true,
      commissionDurationMonths: true,
      attributionWindowDays: true,
      holdingPeriodDays: true,
    },
  });
}

export async function updateProgram(
  ownerId: string,
  merchantId: string,
  programId: string,
  input: ProgramInput
): Promise<void> {
  await assertMerchantOwnership(ownerId, merchantId);

  const existing = await db.program.findFirst({
    where: { id: programId, merchantId },
    select: { id: true },
  });
  if (!existing) {
    throw new Error("Program not found");
  }

  await db.program.update({
    where: { id: programId },
    data: { ...input },
  });
}

// Public — no Owner/session context. Scoped only by merchantId (resolved
// from the request's Host header by the caller), not by ownership, since
// this backs the public signup page.
//
// Looked up by slug: this is the one Program identifier that appears in a
// link sent to a stranger, and a cuid there reads like a tracking id.
export type ProgramForSignup = {
  id: string;
  name: string;
  /** Percentage, e.g. 20 for 20%. Decimal is not serialisable to a client component. */
  defaultCommissionRate: number;
  commissionDurationType: CommissionDurationType;
  commissionDurationMonths: number | null;
  attributionWindowDays: number;
  /** What a customer using one of the affiliate's codes gets. Null: no codes. */
  discountLabel: string | null;
};

export async function getProgramForSignup(
  merchantId: string,
  programSlug: string
): Promise<ProgramForSignup | null> {
  const program = await db.program.findFirst({
    where: { slug: programSlug, merchantId, signupOpen: true },
    select: {
      id: true,
      name: true,
      defaultCommissionRate: true,
      commissionDurationType: true,
      commissionDurationMonths: true,
      attributionWindowDays: true,
      discountRef: true,
      discountLabel: true,
    },
  });
  if (!program) return null;
  const { discountRef, discountLabel, ...rest } = program;
  return {
    ...rest,
    defaultCommissionRate: Number(program.defaultCommissionRate),
    discountLabel: discountRef ? discountLabel : null,
  };
}

/**
 * A program's name when it exists but has sign-ups closed, so its signup link
 * can say "invite only" rather than "not found". Null otherwise.
 */
export async function getClosedProgramName(merchantId: string, programSlug: string): Promise<string | null> {
  const program = await db.program.findFirst({
    where: { slug: programSlug, merchantId, signupOpen: false },
    select: { name: true },
  });
  return program?.name ?? null;
}

// Public, like getProgramForSignup: the program the bare affiliate address
// signs people up to, which is the oldest one still open.
export async function getDefaultProgramSlug(merchantId: string): Promise<string | null> {
  const program = await db.program.findFirst({
    where: { merchantId, signupOpen: true },
    orderBy: { createdAt: "asc" },
    select: { slug: true },
  });
  return program?.slug ?? null;
}
