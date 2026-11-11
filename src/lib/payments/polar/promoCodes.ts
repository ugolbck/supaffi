import { decrypt } from "@/lib/crypto";
import { formatMoney } from "@/lib/format";
import { minorUnitsToMajor } from "@/lib/money";
import type { CouponList } from "@/lib/coupon";
import type { PromoCodeAdapter, PromoFailure, PromoMerchant } from "@/lib/payments/types";
import { isPolarApiError, polarRequest, type PolarConnection } from "@/lib/payments/polar/api";

/**
 * Promo codes on Polar. A Polar discount carries its own code, with no
 * separate code object as on Stripe, so a program picks one of the Owner's
 * discounts as its model and each affiliate's code is a new discount copied
 * from it: same amount, duration and products, under the affiliate's code.
 * An order names the discount it used (discount_id), which is how a sale is
 * matched to its code.
 *
 * Polar has no "first purchase only" rule. The closest is
 * max_redemptions_per_customer, which Polar counts by customer, email and
 * card (polar.sh/docs/features/discounts), so each code is set to one use per
 * customer.
 *
 * Needs the token's discounts:read and discounts:write scopes. A token without
 * them still tracks sales; the screens that need them say to replace it.
 */

type PolarDiscount = {
  id: string;
  name: string;
  code: string | null;
  type: "percentage" | "fixed";
  basis_points?: number;
  amount?: number;
  currency?: string;
  amounts?: Record<string, number>;
  duration: "once" | "forever" | "repeating";
  duration_in_months?: number | null;
  starts_at?: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  redemptions_count: number;
  products?: { id: string }[];
  metadata?: Record<string, unknown>;
};

const UNREACHABLE: PromoFailure = { ok: false, error: "Polar could not be reached. Try again." };

function connection(merchant: PromoMerchant): PolarConnection {
  if (!merchant.paymentKeyEnc) throw new Error("Polar is not connected for this Merchant");
  return { token: decrypt(merchant.paymentKeyEnc), sandbox: merchant.paymentSandbox };
}

const lacks = (err: unknown) => isPolarApiError(err) && (err.status === 401 || err.status === 403);

/** "20% off for 3 months", "$10 off the first payment", "20% off forever", as for a Stripe coupon. */
export function polarDiscountLabel(discount: PolarDiscount): string {
  let off: string;
  if (discount.type === "percentage") {
    off = `${Number(((discount.basis_points ?? 0) / 100).toFixed(2))}% off`;
  } else {
    const [currency, amount] =
      discount.amount !== undefined && discount.currency
        ? [discount.currency, discount.amount]
        : (Object.entries(discount.amounts ?? {})[0] ?? ["usd", 0]);
    off = `${formatMoney(minorUnitsToMajor(amount, currency), currency).replace(/\.00$/, "")} off`;
  }
  if (discount.duration === "once") return `${off} the first payment`;
  if (discount.duration === "repeating") {
    const months = discount.duration_in_months ?? 1;
    return `${off} for ${months} month${months === 1 ? "" : "s"}`;
  }
  return `${off} forever`;
}

/** Still applicable: not ended, and not used up. */
function usable(discount: PolarDiscount, now: number = Date.now()): boolean {
  if (discount.ends_at && new Date(discount.ends_at).getTime() <= now) return false;
  return discount.max_redemptions === null || discount.redemptions_count < discount.max_redemptions;
}

function madeBySupaffi(discount: PolarDiscount): boolean {
  return typeof discount.metadata?.supaffi_affiliate_id === "string";
}

type Page = { items: PolarDiscount[]; pagination?: { max_page?: number } };

// Enough for any program's choice: the affiliates' own codes are counted too,
// so one page could hold nothing but theirs.
const MAX_PAGES = 10;

/** Every discount a list call answers, page by page. */
async function allDiscounts(polar: PolarConnection, query?: string): Promise<PolarDiscount[]> {
  const items: PolarDiscount[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const search = `${query ? `query=${encodeURIComponent(query)}&` : ""}limit=100&page=${page}`;
    const answer = await polarRequest<Page>(polar, "GET", `/v1/discounts/?${search}`);
    items.push(...answer.items);
    if (answer.items.length < 100 || page >= (answer.pagination?.max_page ?? page)) break;
  }
  return items;
}

/**
 * Discounts whose code is this text, any case. The list's `query` filters on
 * name or code containing the text (server/polar/discount/service.py), so the
 * exact match is made here.
 */
async function withCode(polar: PolarConnection, code: string): Promise<PolarDiscount[]> {
  return (await allDiscounts(polar, code)).filter((d) => d.code?.toLowerCase() === code.toLowerCase());
}

/**
 * Whether this code already exists, as this affiliate's own copy (a create
 * whose answer was lost: Polar has no idempotency key, so it is adopted
 * rather than refused) or as anyone else's.
 */
async function existing(polar: PolarConnection, code: string, affiliateId: string): Promise<{ own: PolarDiscount } | "taken" | null> {
  const found = await withCode(polar, code);
  const own = found.find((d) => d.metadata?.supaffi_affiliate_id === affiliateId);
  if (own) return { own };
  return found.length > 0 ? "taken" : null;
}

export const polarPromoCodes: PromoCodeAdapter = {
  async listDiscounts(merchant): Promise<CouponList> {
    try {
      const items = await allDiscounts(connection(merchant));
      return {
        ok: true,
        // The affiliates' own codes are copies, never a program's model.
        coupons: items
          .filter((d) => usable(d) && !madeBySupaffi(d))
          .map((d) => ({ id: d.id, name: d.name, label: polarDiscountLabel(d) })),
      };
    } catch (err) {
      if (lacks(err)) return { ok: false, error: "Your Polar token can't read discounts.", keyLacksPermission: true };
      return UNREACHABLE;
    }
  },

  async discountById(merchant, discountRef) {
    try {
      const discount = await polarRequest<PolarDiscount>(connection(merchant), "GET", `/v1/discounts/${encodeURIComponent(discountRef)}`);
      if (!usable(discount)) return { ok: false, error: "That discount can no longer be used" };
      return { ok: true, label: polarDiscountLabel(discount) };
    } catch (err) {
      if (isPolarApiError(err) && err.status === 404) return { ok: false, error: "That discount can no longer be used" };
      if (lacks(err)) return { ok: false, error: "Your Polar token can't read discounts." };
      return UNREACHABLE;
    }
  },

  // More than one match is refused rather than guessed.
  async findCode(merchant, code) {
    let found: PolarDiscount[];
    try {
      found = (await withCode(connection(merchant), code)).filter((d) => usable(d));
    } catch (err) {
      if (lacks(err)) return { ok: false, error: "Your Polar token can't read discounts.", keyLacksPermission: true };
      return UNREACHABLE;
    }
    if (found.length === 0) return { ok: false, error: "No active discount with that code in Polar" };
    if (found.length > 1) return { ok: false, error: "More than one discount in Polar uses that code" };
    return { ok: true, ref: found[0].id, code: found[0].code! };
  },

  async createCode(merchant, { discountRef, code, affiliateId }) {
    const polar = connection(merchant);
    let model: PolarDiscount;
    try {
      model = await polarRequest<PolarDiscount>(polar, "GET", `/v1/discounts/${encodeURIComponent(discountRef)}`);
      // Polar refuses a code another discount of the organization uses, with
      // a validation error. Asking first says "taken" plainly.
      const found = await existing(polar, code, affiliateId);
      if (found === "taken") return { ok: false, error: "That code is taken" };
      if (found) return { ok: true, ref: found.own.id, code: found.own.code ?? code };
    } catch (err) {
      if (isPolarApiError(err) && err.status === 404) return { ok: false, error: "The program's discount no longer exists in Polar" };
      if (lacks(err)) return { ok: false, error: "Your Polar token can't create promo codes.", keyLacksPermission: true };
      return UNREACHABLE;
    }
    if (!usable(model)) return { ok: false, error: "The program's discount can no longer be used" };

    const amount =
      model.type === "percentage"
        ? { basis_points: model.basis_points }
        : { amounts: model.amounts ?? (model.currency ? { [model.currency]: model.amount ?? 0 } : {}) };
    try {
      const created = await polarRequest<PolarDiscount>(polar, "POST", "/v1/discounts/", {
        name: `${model.name} ${code}`.slice(0, 100),
        code,
        type: model.type,
        ...amount,
        duration: model.duration,
        ...(model.duration === "repeating" ? { duration_in_months: model.duration_in_months } : {}),
        // A code ends with the discount it copies, as a Stripe promotion code
        // ends with its coupon.
        ...(model.starts_at ? { starts_at: model.starts_at } : {}),
        ...(model.ends_at ? { ends_at: model.ends_at } : {}),
        ...(model.products && model.products.length > 0 ? { products: model.products.map((p) => p.id) } : {}),
        max_redemptions_per_customer: 1,
        metadata: { supaffi_affiliate_id: affiliateId },
      });
      return { ok: true, ref: created.id, code: created.code ?? code };
    } catch (err) {
      if (lacks(err)) return { ok: false, error: "Your Polar token can't create promo codes.", keyLacksPermission: true };
      // A validation error is a code taken since the check above, or
      // something else about the discount Polar will not take.
      if (isPolarApiError(err) && err.status === 422) {
        const found = await existing(polar, code, affiliateId).catch(() => null);
        if (found === "taken") return { ok: false, error: "That code is taken" };
        if (found) return { ok: true, ref: found.own.id, code: found.own.code ?? code };
        return { ok: false, error: "Polar refused that code. Try another, or check the program's discount in Polar." };
      }
      return UNREACHABLE;
    }
  },

  // Polar deletes a discount softly (set_deleted_at, server/polar/discount/
  // service.py): it can no longer be applied, and the orders that used it are
  // left as they were.
  async deactivateCode(merchant, ref) {
    try {
      await polarRequest(connection(merchant), "DELETE", `/v1/discounts/${encodeURIComponent(ref)}`);
      return { ok: true };
    } catch (err) {
      if (isPolarApiError(err) && err.status === 404) return { ok: true };
      if (lacks(err)) return { ok: false, error: "Your Polar token can't turn off promo codes.", keyLacksPermission: true };
      return UNREACHABLE;
    }
  },
};
