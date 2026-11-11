import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { findReferredSubscription, idOf } from "@/lib/payments/stripe/subscriptions";
import { recordSubscriptionEnded } from "@/lib/worker/subscriptionEnded";

export async function handleSubscriptionDeleted(
  merchant: Merchant,
  subscription: Stripe.Subscription
): Promise<void> {
  const referred = await findReferredSubscription(merchant, subscription.id, idOf(subscription.customer));
  if (!referred) return;
  await recordSubscriptionEnded(referred);
}
