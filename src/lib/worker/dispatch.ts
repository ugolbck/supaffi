import type { WebhookEvent } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { handleCheckoutSessionCompleted } from "./handlers/checkoutSessionCompleted";
import { handleInvoicePaid } from "./handlers/invoicePaid";
import { handleChargeRefunded } from "./handlers/chargeRefunded";

export async function processWebhookEvent(row: WebhookEvent): Promise<void> {
  const event = row.payload as unknown as Stripe.Event;
  const merchant = await db.merchant.findUniqueOrThrow({ where: { id: row.merchantId } });

  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutSessionCompleted(merchant, event.data.object as Stripe.Checkout.Session);
    case "invoice.paid":
      return handleInvoicePaid(merchant, event.data.object as Stripe.Invoice);
    case "charge.refunded":
      return handleChargeRefunded(merchant, event.data.object as Stripe.Charge);
    case "customer.subscription.deleted":
      return; // no-op, nothing retroactive (CONTEXT.md)
    default:
      // A Merchant's webhook endpoint may be subscribed to more event types
      // than Supaffi cares about — expected, not a failure.
      return;
  }
}
