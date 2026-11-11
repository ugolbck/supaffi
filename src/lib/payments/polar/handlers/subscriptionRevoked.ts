import type { Merchant } from "@prisma/client";
import { referredSubscriptionFor } from "@/lib/worker/referredSubscription";
import { recordSubscriptionEnded } from "@/lib/worker/subscriptionEnded";
import type { PolarSubscription } from "@/lib/payments/polar/types";

/** The subscription ended, at period end or at once. Earned commissions stay. */
export async function handleSubscriptionRevoked(merchant: Merchant, subscription: PolarSubscription): Promise<void> {
  const referred = await referredSubscriptionFor(merchant.id, subscription.id);
  if (!referred) return;
  await recordSubscriptionEnded(referred);
}
