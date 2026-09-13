import { randomBytes, createHash } from "crypto";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getMerchantByDomain } from "@/lib/merchant";
import { db } from "@/lib/db";

const TOKEN_TTL_MS = 15 * 60 * 1000;

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

// How many unused, unexpired links one Affiliate can hold at once.
export const MAX_LIVE_TOKENS = 3;

/**
 * Issues a new login token and keeps only the newest few live.
 *
 * Refusing a new link once the cap was reached let a stranger request three
 * links for someone else's email and lock them out for fifteen minutes at a
 * time. The raw tokens are only in the emails, so an old one cannot be sent
 * again either. Instead the oldest live ones are deleted, which means the link
 * in the newest email always works.
 */
export async function createAffiliateLoginToken(affiliateId: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  await db.$transaction(async (tx) => {
    // Locks the Affiliate row, so two requests at once cannot both keep the
    // same older tokens and leave one more live than the cap.
    await tx.$queryRaw`SELECT "id" FROM "Affiliate" WHERE "id" = ${affiliateId} FOR UPDATE`;
    const older = await tx.affiliateLoginToken.findMany({
      where: { affiliateId, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      skip: MAX_LIVE_TOKENS - 1,
      select: { id: true },
    });
    if (older.length > 0) {
      await tx.affiliateLoginToken.deleteMany({ where: { id: { in: older.map((t) => t.id) } } });
    }
    await tx.affiliateLoginToken.create({
      data: {
        affiliateId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });
  });
  return rawToken;
}

export async function consumeAffiliateLoginToken(
  rawToken: string
): Promise<{ id: string; email: string } | null> {
  const tokenHash = hashToken(rawToken);
  const record = await db.affiliateLoginToken.findUnique({
    where: { tokenHash },
    select: { id: true, affiliateId: true, expiresAt: true, usedAt: true },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return null;
  }

  // Mark used via a conditional updateMany, not a plain update — if a
  // second request races in with the same raw token before this completes,
  // the affected-row count tells us whether we actually won the race, not
  // just that the row existed.
  const claimed = await db.affiliateLoginToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) {
    return null;
  }

  return db.affiliate.findUnique({
    where: { id: record.affiliateId },
    select: { id: true, email: true },
  });
}

/**
 * The guard every screen under /affiliates/dashboard runs.
 *
 * Two checks, not one. The session says who the Affiliate is; the host says
 * which Merchant's site they are on. An Affiliate of one Merchant loading
 * another Merchant's dashboard has a valid session and no business here, so
 * a mismatch is a redirect, not a partial render.
 */
export async function requireAffiliate(): Promise<{
  affiliateId: string;
  email: string;
  merchant: { id: string; name: string; websiteUrl: string };
}> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "affiliate") redirect("/affiliates/login");

  const host = (await headers()).get("host");
  const merchant = host ? await getMerchantByDomain(host) : null;
  if (!merchant) redirect("/affiliates/login");

  const affiliate = await db.affiliate.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, merchantId: true },
  });
  if (!affiliate || affiliate.merchantId !== merchant.id) redirect("/affiliates/login");

  return {
    affiliateId: affiliate.id,
    email: affiliate.email,
    merchant: { id: merchant.id, name: merchant.name, websiteUrl: merchant.websiteUrl },
  };
}
