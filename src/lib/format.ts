import type { CurrencyTotal } from "@/lib/analytics";

/**
 * Money formatting shared by every screen that prints an amount.
 *
 * Supaffi never converts across currencies (CONTEXT.md), so a total is
 * always a list, one entry per currency it was ever paid in. The first
 * currency is the headline figure; the rest become the hint line
 * underneath, rather than a second number competing for the same spot.
 *
 * Amounts print with the currency's own symbol and thousands grouping,
 * the way a person writes them: $1,220.00, €60.00, £19.00. A currency the
 * runtime does not know falls back to the code, so a rare one still reads
 * rather than throwing.
 */

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string): Intl.NumberFormat | null {
  const code = currency.toUpperCase();
  if (formatters.has(code)) return formatters.get(code)!;
  try {
    const formatter = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatters.set(code, formatter);
    return formatter;
  } catch {
    return null;
  }
}

/** One amount in one currency: "$1,220.00", "€60.00", "-£5.70". */
export function formatMoney(amount: number | string, currency: string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  const formatter = formatterFor(currency);
  if (!formatter || Number.isNaN(value)) return `${amount} ${currency.toUpperCase()}`;
  return formatter.format(value);
}

/** The symbol alone, for an axis or a column head: "$", "€", "CHF". */
export function currencySymbol(currency: string): string {
  const formatter = formatterFor(currency);
  if (!formatter) return currency.toUpperCase();
  return formatter.formatToParts(0).find((part) => part.type === "currency")?.value ?? currency.toUpperCase();
}

/**
 * The same list with one currency moved to the front, so the headline
 * figure on a page agrees with the currency its chart is drawn in. Amounts
 * across currencies cannot be ranked, so this is the only honest way to
 * choose which one leads.
 */
export function prefer(totals: CurrencyTotal[], currency: string | null): CurrencyTotal[] {
  if (!currency) return totals;
  const index = totals.findIndex((t) => t.currency === currency);
  if (index <= 0) return totals;
  return [totals[index], ...totals.slice(0, index), ...totals.slice(index + 1)];
}

export function money(totals: CurrencyTotal[]): string {
  if (totals.length === 0) return "0.00";
  const [first] = totals;
  return formatMoney(first.total, first.currency);
}

export function moneyHint(totals: CurrencyTotal[]): string | undefined {
  if (totals.length < 2) return undefined;
  return totals
    .slice(1)
    .map((t) => formatMoney(t.total, t.currency))
    .join("  ·  ");
}

/** A whole number with thousands grouping: 31,143. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}
