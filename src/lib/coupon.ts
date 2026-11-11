import { promoCodeInput } from "@/lib/promoCodeInput";

/**
 * The discounts an Owner can put behind a program's promo codes, as the
 * payment provider lists them (a Stripe coupon, a Polar discount), and the
 * codes an Affiliate may be offered.
 */

export type CouponOption = { id: string; name: string | null; label: string };

export type CouponList =
  | { ok: true; coupons: CouponOption[] }
  | { ok: false; error: string; keyLacksPermission?: true };

/**
 * The codes an Affiliate may be offered before they type their own, best
 * first: their link code in capitals, with the percentage when the discount
 * is one (ALICE20), the way creators name theirs. Read off the label so no
 * second copy of the coupon has to be stored for it.
 */
export function suggestedCodes(linkCode: string, label: string | null): string[] {
  const percent = label?.match(/^(\d+)% off/)?.[1] ?? "";
  const name = promoCodeInput(linkCode);
  // After the first: the name alone, then numbered, for when the first was
  // used before and turned off.
  const numbered = [2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${name.slice(0, 19)}${n}`);
  return [...new Set([`${name.slice(0, 20 - percent.length)}${percent}`, name, ...numbered])];
}
