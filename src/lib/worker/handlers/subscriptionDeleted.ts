import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";

/**
 * Nothing retroactive: commissions already earned stay earned, which is what
 * CONTEXT.md means by no clawback on cancellation. This only records that the
 * customer stopped, so both dashboards can say so. An affiliate promoting a
 * recurring product otherwise watches their income end with no explanation,
 * which is the moment they decide the merchant is cheating them.
 */
export async function handleSubscriptionDeleted(
  merchant: Merchant,
  subscription: Stripe.Subscription
): Promise<void> {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  if (!customerId) return;

  await db.click.updateMany({
    where: { stripeCustomerId: customerId, affiliate: { merchantId: merchant.id } },
    data: { subscriptionCancelledAt: new Date() },
  });
}
