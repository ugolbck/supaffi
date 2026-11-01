/**
 * A promo code as it is typed: capitals, letters and digits only, at most 20,
 * which is what Supaffi creates in Stripe. Applied on every keystroke, so the
 * field never holds a code that would be refused.
 */
export function promoCodeInput(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
}
