import type { CurrencyTotal } from "@/lib/analytics";

/**
 * Money formatting shared by every screen that reads a `CurrencyTotal[]`.
 *
 * Supaffi never converts across currencies (CONTEXT.md), so a total is
 * always a list, one entry per currency it was ever paid in. The first
 * currency (alphabetical, per `analytics.ts`) is the headline figure; the
 * rest become the hint line underneath, rather than a second number
 * competing for the same spot.
 */
export function money(totals: CurrencyTotal[]): string {
  if (totals.length === 0) return "0.00";
  const [first] = totals;
  return `${first.total} ${first.currency.toUpperCase()}`;
}

export function moneyHint(totals: CurrencyTotal[]): string | undefined {
  if (totals.length < 2) return undefined;
  return totals
    .slice(1)
    .map((t) => `${t.total} ${t.currency.toUpperCase()}`)
    .join("  ·  ");
}
