import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { findReferredSubscription, idOf } from "../referredSubscription";

/**
 * Nothing retroactive: commissions already earned stay earned, which is what
 * CONTEXT.md means by no clawback on cancellation. This only records that the
 * customer stopped, so both dashboards can say so. An affiliate promoting a
 * recurring product otherwise watches their income end with no explanation,
 * which is the moment they decide the merchant is cheating them.
 *
 * Matched on the subscription, like renewals. A referred customer cancelling a
 * subscription nobody referred, or one on another product sharing the Stripe
 * account, says nothing about this referral. A click that brought several
 * subscriptions only stops paying once all of them have ended.
 */
export async function handleSubscriptionDeleted(
  merchant: Merchant,
  subscription: Stripe.Subscription
): Promise<void> {
  const referred = await findReferredSubscription(merchant, subscription.id, idOf(subscription.customer));
  if (!referred) return;

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
