/**
 * URL slugs for the things an Owner names.
 *
 * Ids are cuids, which is right for a primary key and wrong for a URL: an
 * Owner reading `/dashboard/products/cmtivutsa000206rusua5qfrm` learns
 * nothing, cannot say it out loud, and cannot tell two products apart in
 * their own browser history. The slug is what the URL carries; the id stays
 * below the route boundary.
 *
 * A slug is derived once, when the thing is created, and does not follow a
 * later rename. Renaming a product should not silently break every link and
 * bookmark pointing at it.
 */

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, ""); // the slice can leave a trailing separator

  return slug;
}

/**
 * First free slug in `base`, `base-2`, `base-3`, ...
 *
 * `taken` is asked once per candidate rather than being handed a list, so the
 * caller decides what uniqueness means: per Owner for a product, per Merchant
 * for a program. Collisions are rare enough that the linear walk never
 * matters.
 *
 * This is not a substitute for the database's unique constraint. Two
 * concurrent creates can both see the same slug as free; the constraint is
 * what actually stops the second one.
 */
export async function uniqueSlug(
  name: string,
  fallback: string,
  taken: (candidate: string) => Promise<boolean>
): Promise<string> {
  const base = slugify(name) || fallback;
  let candidate = base;
  let suffix = 1;

  while (await taken(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}
