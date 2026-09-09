/**
 * Where a commission action is allowed to land.
 *
 * The list URL an action returns to arrives as a bound argument, which is a
 * value the browser posts: it is not trusted to be a URL on this ledger at
 * all. `startsWith` is not enough, because a path can start with the ledger
 * and still resolve somewhere else once `..` segments are applied, and a
 * protocol-relative `//host` or an absolute URL would leave the instance
 * entirely. So it is parsed, and only an exact match on this product's
 * commissions path survives; everything else falls back to the bare list.
 */
export function safeListHref(listHref: string, base: string): string {
  let url: URL;
  try {
    url = new URL(listHref, "http://x");
  } catch {
    return base;
  }
  // A same-origin resolution is the only thing that stayed on this instance:
  // "//host/x" and "https://elsewhere/x" both parse fine and both leave.
  if (url.origin !== "http://x") return base;
  // Exact, not a prefix: ".." segments are already resolved by now, so a path
  // that walked out of the ledger no longer looks like it.
  if (url.pathname !== base) return base;
  return `${url.pathname}${url.search}`;
}
