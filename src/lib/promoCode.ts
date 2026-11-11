import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { CurrencyTotal } from "@/lib/analytics";
import { stripeClientFor } from "@/lib/payments/stripe/client";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { stripeKeyLacksPermission, suggestedCodes } from "@/lib/coupon";

/**
 * Stripe promotion codes that credit an Affiliate.
 *
 * Most are issued: Supaffi creates the code in Stripe from the coupon on the
 * Affiliate's program, under a name the Affiliate (or the Owner) picks. The
 * Owner can also link a code that already exists in Stripe, for a deal made
 * outside the program.
 *
 * A Checkout Session names the code it used only by Stripe's id
 * (`discounts[].promotion_code`, "Promotion code attached to the Checkout
 * Session", Stripe docs, api/checkout/sessions/object), never by the text the
 * customer typed. So the text is turned into that id here, once, when the
 * Owner adds it, and every sale after that is matched on the id with no
 * further Stripe call. Creating and deactivating a code need
 * `promotion_code_write` ("POST /v1/promotion_codes" and
 * "POST /v1/promotion_codes/{id}", Stripe docs, keys/permissions-reference.md),
 * which also covers the lookup: "Write permissions include read permissions"
 * (keys/restricted-api-keys.md).
 */

export const MAX_PROMO_CODES_PER_AFFILIATE = 20;
// Far longer than any code Stripe would hold; only stops an absurd paste
// from reaching the Stripe request.
const MAX_CODE_LENGTH = 200;

export type PromoCodeRow = { id: string; code: string; discountLabel: string | null };

/** `keyLacksPermission` sends the Owner to replace the key, from the form. */
export type PromoCodeResult = { ok: true } | { ok: false; error: string; keyLacksPermission?: true };

const ACTIVE = { disabledAt: null } as const;

type Lookup =
  | { kind: "one"; code: Stripe.PromotionCode }
  | { kind: "none" }
  | { kind: "many" }
  | { kind: "keyLacksPermission" }
  | { kind: "unreachable" };

/**
 * The active promotion codes with this text. `code` "Only return promotion
 * codes that have this case-insensitive code" (Stripe docs,
 * api/promotion_codes/list.md). Codes limited to different customers may share
 * the same text, so there can be more than one.
 */
async function lookUp(stripe: Stripe, code: string): Promise<Lookup> {
  let list: Stripe.ApiList<Stripe.PromotionCode>;
  try {
    list = await stripe.promotionCodes.list({ code, active: true, limit: 2 });
  } catch (err) {
    return { kind: stripeKeyLacksPermission(err) ? "keyLacksPermission" : "unreachable" };
  }
  if (list.data.length === 0) return { kind: "none" };
  if (list.data.length > 1) return { kind: "many" };
  return { kind: "one", code: list.data[0] };
}

const UNREACHABLE = { ok: false, error: "Stripe could not be reached. Try again." } as const;

async function ownedAffiliate(ownerId: string, merchantId: string, affiliateId: string) {
  return db.affiliate.findFirst({
    where: { id: affiliateId, merchantId, merchant: { ownerId } },
    select: { id: true, merchant: { select: { id: true, paymentProvider: true, paymentKeyEnc: true } } },
  });
}

export async function addPromoCode(
  ownerId: string,
  merchantId: string,
  affiliateId: string,
  rawCode: string
): Promise<PromoCodeResult> {
  const code = rawCode.trim();
  if (code === "") return { ok: false, error: "Enter a code" };
  if (code.length > MAX_CODE_LENGTH) return { ok: false, error: "That code is too long" };

  const affiliate = await ownedAffiliate(ownerId, merchantId, affiliateId);
  if (!affiliate) return { ok: false, error: "Affiliate not found" };
  if (affiliate.merchant.paymentProvider !== "STRIPE") return { ok: false, error: "Promo codes need Stripe" };
  if (!affiliate.merchant.paymentKeyEnc) return { ok: false, error: "Connect Stripe first" };

  const count = await db.affiliatePromoCode.count({ where: { affiliateId, ...ACTIVE } });
  if (count >= MAX_PROMO_CODES_PER_AFFILIATE) {
    return { ok: false, error: `An affiliate can have up to ${MAX_PROMO_CODES_PER_AFFILIATE} codes` };
  }

  // More than one match is refused rather than guessed: there is no telling
  // which one the Owner means.
  const lookup = await lookUp(stripeClientFor(affiliate.merchant), code);
  if (lookup.kind === "keyLacksPermission") {
    return { ok: false, error: "Your Stripe key can't read promotion codes.", keyLacksPermission: true };
  }
  if (lookup.kind === "unreachable") return UNREACHABLE;
  if (lookup.kind === "none") return { ok: false, error: "No active promotion code with that text in Stripe" };
  if (lookup.kind === "many") return { ok: false, error: "More than one promotion code in Stripe uses that text" };

  try {
    await db.affiliatePromoCode.create({
      data: {
        merchantId,
        affiliateId,
        promoCodeRef: lookup.code.id,
        code: lookup.code.code,
      },
    });
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    return { ok: false, error: "That code already belongs to an affiliate" };
  }
  return { ok: true };
}

// What the customer types: Stripe takes letters, digits and dashes (Stripe
// docs, api/promotion_codes/create, `code`). Letters and digits only here,
// and short, because a creator reads it out in a video.
const CODE_PATTERN = /^[A-Z0-9]{3,20}$/;

/**
 * Creates a code in Stripe from the program's coupon, under the name given,
 * and gives it to the Affiliate. One live issued code per Affiliate: a second
 * is refused until the first is turned off.
 *
 * `restrictions.first_time_transaction` keeps it to "Customers without any
 * successful payments or invoices" (Stripe docs, api/promotion_codes/create),
 * so a code that leaks to a coupon site is no use to existing customers.
 */
async function issue(affiliateId: string, rawCode: string): Promise<PromoCodeResult> {
  const code = rawCode.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) return { ok: false, error: "Use 3 to 20 letters or numbers" };

  const affiliate = await db.affiliate.findUnique({
    where: { id: affiliateId },
    select: {
      merchantId: true,
      merchant: { select: { ownerId: true, paymentProvider: true, paymentKeyEnc: true } },
      program: { select: { discountRef: true, discountLabel: true } },
      promoCodes: { where: { issued: true, ...ACTIVE }, select: { id: true } },
      _count: { select: { promoCodes: { where: { issued: true } } } },
    },
  });
  if (!affiliate) return { ok: false, error: "Affiliate not found" };
  const { discountRef, discountLabel } = affiliate.program;
  if (!discountRef) return { ok: false, error: "This program has no discount" };
  if (affiliate.promoCodes.length > 0) return { ok: false, error: "There is already a code" };
  if (affiliate.merchant.paymentProvider !== "STRIPE") return { ok: false, error: "Promo codes need Stripe" };
  if (!affiliate.merchant.paymentKeyEnc) return { ok: false, error: "Connect Stripe first" };
  // A turned off code is inactive in Stripe, which would let its text be used
  // again. Refused here, so a code that leaked stays dead.
  if ((await usedBefore(affiliate.merchant.ownerId, [code])).length > 0) return { ok: false, error: "That code is taken" };

  const stripe = stripeClientFor(affiliate.merchant);
  // Stripe refuses a code another active one already uses ("must be unique
  // across all active promotion codes", api/promotion_codes/create) with the
  // same invalid request error a key without the permission gets. Asking
  // first is what tells "taken" apart from "your key can't".
  const existing = await lookUp(stripe, code);
  if (existing.kind === "keyLacksPermission") {
    return { ok: false, error: "Your Stripe key can't create promo codes.", keyLacksPermission: true };
  }
  if (existing.kind === "unreachable") return UNREACHABLE;
  if (existing.kind !== "none") return { ok: false, error: "That code is taken" };

  let created: Stripe.PromotionCode;
  try {
    created = await stripe.promotionCodes.create(
      {
        promotion: { type: "coupon", coupon: discountRef },
        code,
        restrictions: { first_time_transaction: true },
        metadata: { supaffi_affiliate_id: affiliateId },
      },
      // A double click makes one code, not two. The count moves on once a
      // code is made, so claiming again after turning one off is a new key.
      { idempotencyKey: `supaffi-promo:${affiliateId}:${affiliate._count.promoCodes}:${code}` }
    );
  } catch (err) {
    // A key that can read codes but not create them gets here: the lookup
    // above passed, and Stripe answers the create with an invalid request.
    if (stripeKeyLacksPermission(err)) {
      return { ok: false, error: "Your Stripe key can't create promo codes.", keyLacksPermission: true };
    }
    return UNREACHABLE;
  }

  await db.affiliatePromoCode.create({
    data: {
      merchantId: affiliate.merchantId,
      affiliateId,
      promoCodeRef: created.id,
      code: created.code,
      issued: true,
      discountLabel,
    },
  });
  return { ok: true };
}

/** The Affiliate claiming their own code, from their dashboard. */
export async function claimPromoCode(affiliateId: string, code: string): Promise<PromoCodeResult> {
  return issue(affiliateId, code);
}

/** The Owner making the code for an Affiliate, from the affiliate panel. */
export async function issuePromoCode(
  ownerId: string,
  merchantId: string,
  affiliateId: string,
  code: string
): Promise<PromoCodeResult> {
  if (!(await ownedAffiliate(ownerId, merchantId, affiliateId))) return { ok: false, error: "Affiliate not found" };
  return issue(affiliateId, code);
}

/**
 * Stops a code crediting anyone. An issued code is deactivated in Stripe too,
 * so customers can no longer use it; a linked one is the Owner's own and is
 * left as it is in Stripe. The subscriptions a code already brought keep
 * earning, because they belong to the click that sale recorded, not to the
 * code. Kept, not deleted, so its sales stay counted on it.
 */
export async function turnOffPromoCode(
  ownerId: string,
  merchantId: string,
  affiliateId: string,
  promoCodeId: string
): Promise<PromoCodeResult> {
  const affiliate = await ownedAffiliate(ownerId, merchantId, affiliateId);
  if (!affiliate) return { ok: false, error: "Affiliate not found" };
  const code = await db.affiliatePromoCode.findFirst({
    where: { id: promoCodeId, affiliateId, merchantId, ...ACTIVE },
    select: { id: true, issued: true, promoCodeRef: true },
  });
  if (!code) return { ok: true };

  if (code.issued) {
    try {
      await stripeClientFor(affiliate.merchant).promotionCodes.update(code.promoCodeRef, { active: false });
    } catch (err) {
      if (stripeKeyLacksPermission(err)) {
        return { ok: false, error: "Your Stripe key can't turn off promo codes.", keyLacksPermission: true };
      }
      return UNREACHABLE;
    }
  }
  await db.affiliatePromoCode.update({ where: { id: code.id }, data: { disabledAt: new Date() } });
  return { ok: true };
}

/** The codes that credit this Affiliate now, oldest first. */
export async function listPromoCodes(affiliateId: string): Promise<PromoCodeRow[]> {
  return db.affiliatePromoCode.findMany({
    where: { affiliateId, ...ACTIVE },
    select: { id: true, code: true, discountLabel: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * What the Affiliate's dashboard shows next to their link: their live code,
 * or, when they have none and their program has a discount, the claim form
 * with a name already filled in. Neither when there is nothing to offer.
 */
export type PromoCodeOffer =
  | { kind: "code"; code: string; discountLabel: string | null }
  | { kind: "claim"; suggested: string; discountLabel: string }
  | null;

export async function promoCodeOffer(affiliateId: string): Promise<PromoCodeOffer> {
  const affiliate = await db.affiliate.findUnique({
    where: { id: affiliateId },
    select: {
      merchant: { select: { ownerId: true } },
      program: { select: { discountRef: true, discountLabel: true } },
      links: { where: { isPrimary: true }, select: { code: true }, take: 1 },
      // An issued code first: it is the one made for this program.
      promoCodes: { where: ACTIVE, select: { code: true, discountLabel: true }, orderBy: [{ issued: "desc" }, { createdAt: "asc" }], take: 1 },
    },
  });
  if (!affiliate) return null;
  const live = affiliate.promoCodes[0];
  if (live) return { kind: "code", code: live.code, discountLabel: live.discountLabel };
  const { discountRef, discountLabel } = affiliate.program;
  if (!discountRef || !discountLabel) return null;
  const candidates = suggestedCodes(affiliate.links[0]?.code ?? "", discountLabel).filter((c) => CODE_PATTERN.test(c));
  const used = new Set((await usedBefore(affiliate.merchant.ownerId, candidates)).map((c) => c.toUpperCase()));
  const suggested = candidates.find((c) => !used.has(c)) ?? "";
  return { kind: "claim", suggested, discountLabel };
}

/**
 * The texts among `codes` any of this Owner's products has had a code under,
 * live or off. Across products, because products can share a Stripe account.
 */
async function usedBefore(ownerId: string, codes: string[]): Promise<string[]> {
  if (codes.length === 0) return [];
  const rows = await db.affiliatePromoCode.findMany({
    where: { merchant: { ownerId }, OR: codes.map((code) => ({ code: { equals: code, mode: "insensitive" as const } })) },
    select: { code: true },
  });
  return rows.map((r) => r.code);
}

export type PromoCodeStats = PromoCodeRow & { issued: boolean; off: boolean; conversions: number; earned: CurrencyTotal[] };

/**
 * Every code with what it has brought in, counted the way a link's sales are
 * (listLinksWithStats): a voided sale is not counted or earned, an unpaid
 * adjustment row counts nowhere, a paid one stays in.
 */
export async function listPromoCodesWithStats(affiliateId: string): Promise<PromoCodeStats[]> {
  // Turned off ones too, after the live ones: what they earned is still theirs.
  const codes = (
    await db.affiliatePromoCode.findMany({
      where: { affiliateId },
      select: { id: true, code: true, discountLabel: true, issued: true, disabledAt: true },
      orderBy: [{ disabledAt: { sort: "desc", nulls: "first" } }, { createdAt: "asc" }],
    })
  ).map(({ disabledAt, ...code }) => ({ ...code, off: disabledAt !== null }));
  if (codes.length === 0) return [];

  const rows = await db.commission.findMany({
    where: {
      affiliateId,
      click: { promoCodeId: { in: codes.map((c) => c.id) } },
      status: { not: "VOIDED" },
      OR: [{ status: "PAID" }, { adjustsCommissionId: null }],
    },
    select: { amount: true, currency: true, click: { select: { promoCodeId: true } } },
  });

  const totals = new Map<string, Map<string, Prisma.Decimal>>();
  const conversions = new Map<string, number>();
  for (const row of rows) {
    const codeId = row.click.promoCodeId;
    if (!codeId) continue;
    conversions.set(codeId, (conversions.get(codeId) ?? 0) + 1);
    const byCurrency = totals.get(codeId) ?? new Map<string, Prisma.Decimal>();
    byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? new Prisma.Decimal(0)).add(row.amount));
    totals.set(codeId, byCurrency);
  }

  return codes.map((code) => ({
    ...code,
    conversions: conversions.get(code.id) ?? 0,
    earned: [...(totals.get(code.id) ?? new Map<string, Prisma.Decimal>())]
      .map(([currency, total]) => ({ currency, total: total.toFixed(2) }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
  }));
}
