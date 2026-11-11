import type Stripe from "stripe";
import { formatMoney } from "@/lib/format";
import { minorUnitsToMajor } from "@/lib/money";
import type { CouponList } from "@/lib/coupon";
import type { PromoCodeAdapter, PromoMerchant } from "@/lib/payments/types";
import { stripeClientFor } from "@/lib/payments/stripe/client";

/**
 * Promo codes on Stripe: a program picks one of the Owner's coupons, and each
 * affiliate's code is a promotion code on it.
 *
 * Listing coupons needs `coupon_read` ("GET /v1/coupons | coupon_read", Stripe
 * docs, keys/permissions-reference.md). A restricted key without it gets "an
 * invalid request error" (keys/restricted-api-keys.md), which is why that
 * error type is read as a missing permission here: a list with nothing but a
 * limit has no other way to be invalid.
 *
 * A Checkout Session names the code it used only by Stripe's id
 * (`discounts[].promotion_code`, "Promotion code attached to the Checkout
 * Session", Stripe docs, api/checkout/sessions/object), never by the text the
 * customer typed. So the text is turned into that id once, when the code is
 * added, and every sale after that is matched on the id with no further
 * Stripe call. Creating and deactivating a code need `promotion_code_write`
 * ("POST /v1/promotion_codes" and "POST /v1/promotion_codes/{id}", Stripe
 * docs, keys/permissions-reference.md), which also covers the lookup: "Write
 * permissions include read permissions" (keys/restricted-api-keys.md).
 */

/**
 * "20% off for 3 months", "$10 off the first payment", "20% off forever". The
 * three durations are Stripe's: `once` is the first charge, `repeating` the
 * first `duration_in_months` months, `forever` every charge (Stripe docs,
 * api/coupons/object).
 */
export function discountLabel(
  coupon: Pick<Stripe.Coupon, "percent_off" | "amount_off" | "currency" | "duration" | "duration_in_months">
): string {
  const off =
    coupon.percent_off !== null
      ? `${Number(coupon.percent_off.toFixed(2))}% off`
      : `${formatMoney(minorUnitsToMajor(coupon.amount_off ?? 0, coupon.currency ?? "usd"), coupon.currency ?? "usd").replace(/\.00$/, "")} off`;
  if (coupon.duration === "once") return `${off} the first payment`;
  if (coupon.duration === "repeating") {
    const months = coupon.duration_in_months ?? 1;
    return `${off} for ${months} month${months === 1 ? "" : "s"}`;
  }
  return `${off} forever`;
}


/** How Stripe answers a restricted key that lacks the permission a call needs. */
export function stripeKeyLacksPermission(err: unknown): boolean {
  const { type, statusCode } = (err ?? {}) as { type?: string; statusCode?: number };
  return (
    type === "StripePermissionError" ||
    type === "StripeInvalidRequestError" ||
    type === "StripeAuthenticationError" ||
    statusCode === 401 ||
    statusCode === 403
  );
}

/** Every coupon that can still be applied, newest first, as Stripe lists them. */
export async function listCoupons(stripe: Stripe): Promise<CouponList> {
  try {
    const list = await stripe.coupons.list({ limit: 100 });
    return {
      ok: true,
      coupons: list.data.filter((c) => c.valid).map((c) => ({ id: c.id, name: c.name, label: discountLabel(c) })),
    };
  } catch (err) {
    if (stripeKeyLacksPermission(err)) {
      return { ok: false, error: "Your Stripe key can't read coupons.", keyLacksPermission: true };
    }
    return { ok: false, error: "Stripe could not be reached. Try again." };
  }
}

/** One coupon by id, for saving a program: still valid, and its label as of now. */
export async function couponById(
  stripe: Stripe,
  couponId: string
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  try {
    const coupon = await stripe.coupons.retrieve(couponId);
    if (!coupon.valid) return { ok: false, error: "That coupon can no longer be used" };
    return { ok: true, label: discountLabel(coupon) };
  } catch (err) {
    if (stripeKeyLacksPermission(err)) return { ok: false, error: "Your Stripe key can't read coupons." };
    return { ok: false, error: "Stripe could not be reached. Try again." };
  }
}

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

function client(merchant: PromoMerchant): Stripe {
  return stripeClientFor(merchant);
}

export const stripePromoCodes: PromoCodeAdapter = {
  listDiscounts: (merchant) => listCoupons(client(merchant)),
  discountById: (merchant, couponId) => couponById(client(merchant), couponId),

  // More than one match is refused rather than guessed: there is no telling
  // which one the Owner means.
  async findCode(merchant, code) {
    const lookup = await lookUp(client(merchant), code);
    if (lookup.kind === "keyLacksPermission") {
      return { ok: false, error: "Your Stripe key can't read promotion codes.", keyLacksPermission: true };
    }
    if (lookup.kind === "unreachable") return UNREACHABLE;
    if (lookup.kind === "none") return { ok: false, error: "No active promotion code with that text in Stripe" };
    if (lookup.kind === "many") return { ok: false, error: "More than one promotion code in Stripe uses that text" };
    return { ok: true, ref: lookup.code.id, code: lookup.code.code };
  },

  /**
   * `restrictions.first_time_transaction` keeps the code to "Customers without
   * any successful payments or invoices" (Stripe docs,
   * api/promotion_codes/create), so a code that leaks to a coupon site is no
   * use to existing customers.
   */
  async createCode(merchant, { discountRef, code, affiliateId, attempt }) {
    const stripe = client(merchant);
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

    try {
      const created = await stripe.promotionCodes.create(
        {
          promotion: { type: "coupon", coupon: discountRef },
          code,
          restrictions: { first_time_transaction: true },
          metadata: { supaffi_affiliate_id: affiliateId },
        },
        // A double click makes one code, not two. The count moves on once a
        // code is made, so claiming again after turning one off is a new key.
        { idempotencyKey: `supaffi-promo:${affiliateId}:${attempt}:${code}` }
      );
      return { ok: true, ref: created.id, code: created.code };
    } catch (err) {
      // A key that can read codes but not create them gets here: the lookup
      // above passed, and Stripe answers the create with an invalid request.
      if (stripeKeyLacksPermission(err)) {
        return { ok: false, error: "Your Stripe key can't create promo codes.", keyLacksPermission: true };
      }
      return UNREACHABLE;
    }
  },

  async deactivateCode(merchant, ref) {
    try {
      await client(merchant).promotionCodes.update(ref, { active: false });
      return { ok: true };
    } catch (err) {
      if (stripeKeyLacksPermission(err)) {
        return { ok: false, error: "Your Stripe key can't turn off promo codes.", keyLacksPermission: true };
      }
      return UNREACHABLE;
    }
  },
};
