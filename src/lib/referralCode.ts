import { db } from "@/lib/db";
import { slugify } from "@/lib/slugify";

// Readable, name-based slugs — better CTR/trust than a random ID (see
// prisma/schema.prisma's comment on AffiliateLink.code). Globally
// unique across every Merchant on the Instance, matching the schema's
// bare `@unique` (not scoped to merchantId) — the code appears directly in
// a public `?via=` URL, and staying merchant-agnostic keeps it short and
// unambiguous.
//
// A retired code counts as taken too. It still sits in links another
// Affiliate published, so a new signup must never be handed it.
export async function generateLinkCode(name: string): Promise<string> {
  const base = slugify(name) || "affiliate";
  let candidate = base;
  let suffix = 1;

  while (await isCodeInUse(candidate)) {
    suffix += 1;
    candidate = `${base}${suffix}`;
  }

  return candidate;
}

async function isCodeInUse(code: string): Promise<boolean> {
  const [link, retired] = await Promise.all([
    db.affiliateLink.findUnique({ where: { code }, select: { id: true } }),
    db.retiredLinkCode.findUnique({ where: { code }, select: { id: true } }),
  ]);
  return link !== null || retired !== null;
}
