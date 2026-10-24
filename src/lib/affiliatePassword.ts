import { randomBytes, createHash } from "crypto";
import { db } from "@/lib/db";
import { ConcurrencyLimitError, hashPassword, verifyAgainstNoAccount, verifyPassword } from "@/lib/password";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";

// Affiliate passwords and the links that set them. Nothing here sends email:
// the Owner copies a link from the dashboard and passes it on themselves.

const LINK_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function affiliatePasswordError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

export type AffiliateForLogin = { id: string; email: string; passwordHash: string | null };

export async function findAffiliateForLogin(merchantId: string, email: string): Promise<AffiliateForLogin | null> {
  return db.affiliate.findUnique({
    where: { merchantId_email: { merchantId, email: email.trim().toLowerCase() } },
    select: { id: true, email: true, passwordHash: true },
  });
}

/**
 * Checks a password against the Affiliate found for the attempt. No account,
 * or one with no password yet, still costs a full verify, so the answer takes
 * as long either way and does not say which emails exist.
 */
export async function checkAffiliatePassword(
  affiliate: AffiliateForLogin | null,
  password: string
): Promise<{ id: string; email: string } | null> {
  try {
    if (!affiliate?.passwordHash) {
      await verifyAgainstNoAccount(password);
      return null;
    }
    if (!(await verifyPassword(password, affiliate.passwordHash))) return null;
    return { id: affiliate.id, email: affiliate.email };
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) return null;
    throw err;
  }
}

/**
 * A one-time link that lets an Affiliate set a password, for the Owner to copy
 * and send. Issuing one voids any earlier link for the same Affiliate, so only
 * the newest copy ever works. Scoped to the Owner's product: an id from
 * another product answers null.
 */
export async function createAffiliatePasswordLink(
  ownerId: string,
  merchantId: string,
  affiliateId: string
): Promise<string | null> {
  const affiliate = await db.affiliate.findFirst({
    where: { id: affiliateId, merchantId, merchant: { ownerId } },
    select: { id: true },
  });
  if (!affiliate) return null;

  const rawToken = randomBytes(32).toString("hex");
  await db.$transaction([
    db.affiliateLoginToken.deleteMany({ where: { affiliateId, usedAt: null } }),
    db.affiliateLoginToken.create({
      data: { affiliateId, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + LINK_TTL_MS) },
    }),
  ]);
  return rawToken;
}

/**
 * Spends a password link and saves the new password. The link must belong to
 * an Affiliate of the product it was opened on. Answers the Affiliate's email,
 * so the caller can log them in, or null for a link that is unknown, used,
 * expired or from another product.
 */
export async function redeemAffiliatePasswordLink(
  rawToken: string,
  merchantId: string,
  password: string
): Promise<{ email: string } | null> {
  const record = await db.affiliateLoginToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, expiresAt: true, usedAt: true, affiliate: { select: { id: true, email: true, merchantId: true } } },
  });
  if (!record || record.usedAt || record.expiresAt < new Date() || record.affiliate.merchantId !== merchantId) {
    return null;
  }

  const passwordHash = await hashPassword(password);
  // Claimed and saved together, conditionally, so two submits of one link
  // cannot both set a password.
  const saved = await db.$transaction(async (tx) => {
    const claimed = await tx.affiliateLoginToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) return false;
    await tx.affiliate.update({ where: { id: record.affiliate.id }, data: { passwordHash } });
    return true;
  });
  return saved ? { email: record.affiliate.email } : null;
}
