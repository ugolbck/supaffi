import { randomBytes, createHash } from "crypto";
import { db } from "@/lib/db";

const TOKEN_TTL_MS = 15 * 60 * 1000;

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function createAffiliateLoginToken(affiliateId: string): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  await db.affiliateLoginToken.create({
    data: {
      affiliateId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
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
