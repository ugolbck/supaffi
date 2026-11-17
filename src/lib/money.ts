// Provider amounts are integers in the currency's smallest unit, except for
// a set of zero-decimal currencies (already whole units) and a
// few three-decimal currencies. Getting this wrong silently makes
// Commission.amount 100x too small or large for affected currencies.
// UGX and ISK have no minor unit but are still sent with two decimals, always
// 00 (docs.stripe.com/currencies#special-cases), so they are not listed here.
const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg",
  "rwf", "vnd", "vuv", "xaf", "xof", "xpf",
]);
const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

export function minorUnitsToMajor(amountMinor: number, currency: string): number {
  const cur = currency.toLowerCase();
  if (ZERO_DECIMAL.has(cur)) return amountMinor;
  if (THREE_DECIMAL.has(cur)) return amountMinor / 1000;
  return amountMinor / 100;
}
