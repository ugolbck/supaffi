import { db } from "@/lib/db";

export type AffiliateLinkRow = {
  id: string;
  code: string;
  destinationPath: string | null;
  isPrimary: boolean;
};

/**
 * The link created at signup.
 *
 * Every Affiliate has exactly one, it cannot be deleted, and it is the code the
 * Merchant's own dashboard shows. Returns null only for an Affiliate id that
 * does not exist, which callers already treat as "log in again".
 */
export async function getPrimaryLink(affiliateId: string): Promise<AffiliateLinkRow | null> {
  const link = await db.affiliateLink.findFirst({
    where: { affiliateId, isPrimary: true },
    select: { id: true, code: true, destinationPath: true, isPrimary: true },
  });
  return link ?? null;
}

/** Every link an Affiliate has, primary first, then oldest first. */
export async function listLinks(affiliateId: string): Promise<AffiliateLinkRow[]> {
  return db.affiliateLink.findMany({
    where: { affiliateId },
    select: { id: true, code: true, destinationPath: true, isPrimary: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
}
