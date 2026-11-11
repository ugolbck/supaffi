import type { ReferredSubscription } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Nothing retroactive: commissions already earned stay earned, which is what
 * CONTEXT.md means by no clawback on cancellation. This only records that the
 * customer stopped, so both dashboards can say so. An affiliate promoting a
 * recurring product otherwise watches their income end with no explanation,
 * which is the moment they decide the merchant is cheating them.
 *
 * Matched on the subscription, like renewals. A referred customer cancelling a
 * subscription nobody referred, or one on another product sharing the payment
 * account, says nothing about this referral. A click that brought several
 * subscriptions only stops paying once all of them have ended.
 */
export async function recordSubscriptionEnded(referred: Pick<ReferredSubscription, "id" | "clickId">): Promise<void> {
  const now = new Date();
  await db.referredSubscription.updateMany({
    where: { id: referred.id, cancelledAt: null },
    data: { cancelledAt: now },
  });

  const stillPaying = await db.referredSubscription.count({
    where: { clickId: referred.clickId, cancelledAt: null },
  });
  if (stillPaying > 0) return;

  await db.click.updateMany({
    where: { id: referred.clickId, subscriptionCancelledAt: null },
    data: { subscriptionCancelledAt: now },
  });
}
