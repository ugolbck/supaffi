import { db } from "@/lib/db";

/**
 * How far along the tracking integration is.
 *
 * Three states rather than done/not-done, because the integration has two
 * halves that are proven at different times. The script on the Merchant's site
 * proves itself the moment anyone clicks a referral link. The
 * the Referral Token through on their Checkout Session cannot be proven until
 * somebody actually buys something, which the Owner cannot make happen on
 * demand and should not sit waiting for.
 *
 * So `awaiting-sale` is a real answer, not a fudged completion: clicks are
 * being recorded, the checkout half is still unproven, and the Owner is free
 * to go and recruit affiliates in the meantime.
 */
export type TrackingStatus = "not-started" | "awaiting-sale" | "verified";

export async function getTrackingStatus(merchantId: string): Promise<TrackingStatus> {
  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    select: { trackingVerifiedAt: true },
  });
  if (!merchant) return "not-started";

  // Recorded when the first attributed checkout arrived, so this costs a
  // column read rather than a join across every Click the Merchant ever had.
  if (merchant.trackingVerifiedAt) return "verified";

  const click = await db.click.findFirst({
    where: { affiliate: { merchantId } },
    select: { id: true },
  });
  return click ? "awaiting-sale" : "not-started";
}

export type TrackingTimestamps = {
  /** The most recent Click on this Merchant, of any age. Not the 30 day
   * window `getProductMetrics` draws its chart from: the status screen wants
   * the actual last click, not "none in the last month". */
  lastClickAt: Date | null;
  /** The same column `getTrackingStatus` reads, exposed here so the status
   * screen can print the date without a second Prisma read of its own. */
  verifiedAt: Date | null;
};

/** The two dates the tracking status screen shows: last click, last sale. */
export async function getTrackingTimestamps(merchantId: string): Promise<TrackingTimestamps> {
  const [merchant, lastClick] = await Promise.all([
    db.merchant.findUnique({
      where: { id: merchantId },
      select: { trackingVerifiedAt: true },
    }),
    db.click.findFirst({
      where: { affiliate: { merchantId } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  return {
    lastClickAt: lastClick?.createdAt ?? null,
    verifiedAt: merchant?.trackingVerifiedAt ?? null,
  };
}

/**
 * Records that a checkout arrived carrying a Referral Token.
 *
 * Called from the webhook worker on every attributed checkout, but only the
 * first one writes: the `trackingVerifiedAt: null` guard makes this a no-op
 * from the second sale onwards, so the timestamp keeps meaning "the first
 * time" and the celebration keyed off it cannot be re-triggered.
 */
export async function recordTrackingVerified(merchantId: string): Promise<void> {
  await db.merchant.updateMany({
    where: { id: merchantId, trackingVerifiedAt: null },
    data: { trackingVerifiedAt: new Date() },
  });
}

/**
 * The one render that celebrates: verified, and the Owner has not been told.
 *
 * Separate from `TrackingStatus` because it is about what the Owner has seen,
 * not about what is true of the integration.
 */
export async function shouldCelebrateTracking(merchantId: string): Promise<boolean> {
  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    select: { trackingVerifiedAt: true, trackingVerifiedSeenAt: true },
  });
  return Boolean(merchant?.trackingVerifiedAt && !merchant.trackingVerifiedSeenAt);
}

/**
 * Spends the moment. Scoped by `trackingVerifiedSeenAt: null` so two tabs
 * rendering at once cannot overwrite each other's stamp with a later one.
 */
export async function markTrackingCelebrationSeen(merchantId: string): Promise<void> {
  await db.merchant.updateMany({
    where: { id: merchantId, trackingVerifiedSeenAt: null },
    data: { trackingVerifiedSeenAt: new Date() },
  });
}
