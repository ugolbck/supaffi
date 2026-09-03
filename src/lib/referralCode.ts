import { db } from "@/lib/db";

// Readable, name-based slugs — better CTR/trust than a random ID (see
// prisma/schema.prisma's comment on AffiliateLink.code). Globally
// unique across every Merchant on the Instance, matching the schema's
// bare `@unique` (not scoped to merchantId) — the code appears directly in
// a public `?via=` URL, and staying merchant-agnostic keeps it short and
// unambiguous.
export async function generateLinkCode(name: string): Promise<string> {
  const base = slugify(name) || "affiliate";
  let candidate = base;
  let suffix = 1;

  while (
    await db.affiliateLink.findUnique({
      where: { code: candidate },
      select: { id: true },
    })
  ) {
    suffix += 1;
    candidate = `${base}${suffix}`;
  }

  return candidate;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 30);
}
