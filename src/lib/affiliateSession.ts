import { db } from "@/lib/db";

/**
 * Whether an Affiliate session issued at `issuedAtSeconds` is still valid.
 *
 * The same check as ownerSessionIsCurrent, for the same reason: sessions are
 * JWTs with no adapter behind them, so nothing can be deleted when the
 * password changes, and a cookie held by someone who had the old password
 * would stay good for its full 30 days (long enough to keep rewriting the
 * payout details the Owner pays from). `redeemAffiliateResetLink` writes the
 * stamp, which ends every session issued before it.
 *
 * Both sides are compared in whole seconds. A password link logs the Affiliate
 * straight in, and that new session's issued-at is truncated to the second, so
 * against a stamp in milliseconds it would always read as older than the change
 * it follows. The cost is that a session signed in during the same second as
 * the change survives it.
 *
 * Lives apart from ownerExists.ts, whose import list is held to one entry.
 * A missing Affiliate row is not current, so a deleted account cannot keep a
 * session alive.
 */
export async function affiliateSessionIsCurrent(
  affiliateId: string,
  issuedAtSeconds: number | undefined
): Promise<boolean> {
  const affiliate = await db.affiliate.findUnique({
    where: { id: affiliateId },
    select: { passwordChangedAt: true },
  });
  if (!affiliate) return false;
  if (!affiliate.passwordChangedAt) return true;
  // A token with no issued-at cannot be placed against the change, so it is
  // treated as older than it.
  if (issuedAtSeconds === undefined) return false;
  return issuedAtSeconds >= Math.floor(affiliate.passwordChangedAt.getTime() / 1000);
}
