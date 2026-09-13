import type { WebhookEvent } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { handleCheckoutSessionCompleted } from "./handlers/checkoutSessionCompleted";
import { handleInvoicePaid } from "./handlers/invoicePaid";
import { handleChargeRefunded } from "./handlers/chargeRefunded";
import { handleChargeDisputeClosed } from "./handlers/chargeDisputeClosed";
import { handleSubscriptionDeleted } from "./handlers/subscriptionDeleted";

export async function processWebhookEvent(row: WebhookEvent): Promise<void> {
  const event = row.payload as unknown as Stripe.Event;
  const merchant = await db.merchant.findUniqueOrThrow({ where: { id: row.merchantId } });

  // Keep this switch's cases in sync with src/lib/stripeWebhookEvents.ts's
  // REQUIRED_STRIPE_WEBHOOK_EVENTS list — that's what a Merchant is shown
  // on their Merchant detail page as the events to enable in Stripe.
  switch (event.type) {
    // Both go through one handler, which only creates a commission once the
    // Session says it is paid. A delayed payment method completes the Session
    // unpaid and the second event arrives when the money does; whichever
    // lands first on a paid Session wins, the other dedupes.
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return handleCheckoutSessionCompleted(merchant, event.data.object as Stripe.Checkout.Session, event);
    case "invoice.paid":
      return handleInvoicePaid(merchant, event.data.object as Stripe.Invoice);
    case "charge.refunded":
      return handleChargeRefunded(merchant, event.data.object as Stripe.Charge);
    case "charge.dispute.closed":
      return handleChargeDisputeClosed(merchant, event.data.object as Stripe.Dispute);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(merchant, event.data.object as Stripe.Subscription);
    default:
      // A Merchant's webhook endpoint may be subscribed to more event types
      // than Supaffi cares about — expected, not a failure.
      return;
  }
}
