import type Stripe from "stripe";
import { formatMoney } from "@/lib/format";
import { minorUnitsToMajor } from "@/lib/stripe";
import { promoCodeInput } from "@/lib/promoCodeInput";

/**
 * The Stripe coupons an Owner can put behind a program's promo codes, and the
 * words that say what one gives a customer.
 *
 * Listing needs `coupon_read` ("GET /v1/coupons | coupon_read", Stripe docs,
 * keys/permissions-reference.md). A restricted key without it gets "an invalid
 * request error" (keys/restricted-api-keys.md), which is why that error type is
 * read as a missing permission here: a list with nothing but a limit has no
 * other way to be invalid.
 */

export type CouponOption = { id: string; name: string | null; label: string };

export type CouponList =
  | { ok: true; coupons: CouponOption[] }
  | { ok: false; error: string; keyLacksPermission?: true };

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

/**
 * The code an Affiliate is offered before they type their own: their link code
 * in capitals, with the percentage when the discount is one (ALICE20), the way
 * creators name theirs. Read off the label so no second copy of the coupon has
 * to be stored for it.
 */
export function suggestedCode(linkCode: string, label: string | null): string {
  const percent = label?.match(/^(\d+)% off/)?.[1] ?? "";
  const base = promoCodeInput(linkCode).slice(0, 20 - percent.length);
  return `${base}${percent}`;
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
