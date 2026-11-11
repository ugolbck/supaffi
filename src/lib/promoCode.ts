import { Prisma } from "@prisma/client";
import type { PaymentProvider } from "@prisma/client";
import { db } from "@/lib/db";
import type { CurrencyTotal } from "@/lib/analytics";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { suggestedCodes } from "@/lib/coupon";
import { paymentProviderFor } from "@/lib/payments";
import type { PromoCodeAdapter, PromoMerchant } from "@/lib/payments/types";

/**
 * Promo codes that credit an Affiliate, on whichever payment provider the
 * product uses (its adapter's `promoCodes`).
 *
 * Most are issued: Supaffi creates the code in the provider from the discount
 * on the Affiliate's program, under a name the Affiliate (or the Owner) picks.
 * The Owner can also link a code that already exists in the provider, for a
 * deal made outside the program. Either way the provider's id for the code is
 * stored, and every sale is matched on it.
 */

export const MAX_PROMO_CODES_PER_AFFILIATE = 20;
// Far longer than any code a provider would hold; only stops an absurd paste
// from reaching the provider.
const MAX_CODE_LENGTH = 200;

export type PromoCodeRow = { id: string; code: string; discountLabel: string | null };

/** `keyLacksPermission` sends the Owner to replace the key, from the form. */
export type PromoCodeResult = { ok: true } | { ok: false; error: string; keyLacksPermission?: true };

const ACTIVE = { disabledAt: null } as const;

type MerchantForCodes = PromoMerchant & { paymentProvider: PaymentProvider };

/** The product's promo code adapter, or why it has none to use. */
function codesFor(merchant: MerchantForCodes): { codes: PromoCodeAdapter } | PromoCodeResult {
  const provider = paymentProviderFor(merchant);
  if (!provider.promoCodes) return { ok: false, error: `${provider.name} has no promo codes` };
  if (!merchant.paymentKeyEnc) return { ok: false, error: `Connect ${provider.name} first` };
  return { codes: provider.promoCodes };
}

const MERCHANT_FOR_CODES = { paymentProvider: true, paymentKeyEnc: true, paymentSandbox: true } as const;

async function ownedAffiliate(ownerId: string, merchantId: string, affiliateId: string) {
  return db.affiliate.findFirst({
    where: { id: affiliateId, merchantId, merchant: { ownerId } },
    select: { id: true, merchant: { select: { id: true, ...MERCHANT_FOR_CODES } } },
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
  const ready = codesFor(affiliate.merchant);
  if (!("codes" in ready)) return ready;

  const count = await db.affiliatePromoCode.count({ where: { affiliateId, ...ACTIVE } });
  if (count >= MAX_PROMO_CODES_PER_AFFILIATE) {
    return { ok: false, error: `An affiliate can have up to ${MAX_PROMO_CODES_PER_AFFILIATE} codes` };
  }

  const found = await ready.codes.findCode(affiliate.merchant, code);
  if (!found.ok) return found;

  try {
    await db.affiliatePromoCode.create({
      data: {
        merchantId,
        affiliateId,
        promoCodeRef: found.ref,
        code: found.code,
      },
    });
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    return { ok: false, error: "That code already belongs to an affiliate" };
  }
  return { ok: true };
}

// What the customer types: letters and digits only, which every provider
// takes, and short, because a creator reads it out in a video.
const CODE_PATTERN = /^[A-Z0-9]{3,20}$/;

/**
 * Creates a code in the provider from the program's discount, under the name
 * given, and gives it to the Affiliate. One live issued code per Affiliate: a
 * second is refused until the first is turned off.
 */
async function issue(affiliateId: string, rawCode: string): Promise<PromoCodeResult> {
  const code = rawCode.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) return { ok: false, error: "Use 3 to 20 letters or numbers" };

  const affiliate = await db.affiliate.findUnique({
    where: { id: affiliateId },
    select: {
      merchantId: true,
      merchant: { select: { ownerId: true, ...MERCHANT_FOR_CODES } },
      program: { select: { discountRef: true, discountLabel: true } },
      promoCodes: { where: { issued: true, ...ACTIVE }, select: { id: true } },
      _count: { select: { promoCodes: { where: { issued: true } } } },
    },
  });
  if (!affiliate) return { ok: false, error: "Affiliate not found" };
  const { discountRef, discountLabel } = affiliate.program;
  if (!discountRef) return { ok: false, error: "This program has no discount" };
  if (affiliate.promoCodes.length > 0) return { ok: false, error: "There is already a code" };
  const ready = codesFor(affiliate.merchant);
  if (!("codes" in ready)) return ready;
  // A turned off code is inactive in the provider, which would let its text
  // be used again. Refused here, so a code that leaked stays dead.
  if ((await usedBefore(affiliate.merchant.ownerId, [code])).length > 0) return { ok: false, error: "That code is taken" };

  const created = await ready.codes.createCode(affiliate.merchant, {
    discountRef,
    code,
    affiliateId,
    attempt: affiliate._count.promoCodes,
  });
  if (!created.ok) return created;

  await db.affiliatePromoCode.create({
    data: {
      merchantId: affiliate.merchantId,
      affiliateId,
      promoCodeRef: created.ref,
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
 * Stops a code crediting anyone. An issued code is deactivated in the
 * provider too, so customers can no longer use it; a linked one is the
 * Owner's own and is left as it is. The subscriptions a code already brought keep
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
    const ready = codesFor(affiliate.merchant);
    if (!("codes" in ready)) return ready;
    const off = await ready.codes.deactivateCode(affiliate.merchant, code.promoCodeRef);
    if (!off.ok) return off;
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
 * live or off. Across products, because products can share a payment account.
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
