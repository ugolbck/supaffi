import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { REQUIRED_STRIPE_WEBHOOK_EVENTS } from "@/lib/payments/stripe/webhookEvents";
import { handleCheckoutSessionCompleted } from "@/lib/payments/stripe/handlers/checkoutSessionCompleted";
import { handleInvoicePaid } from "@/lib/payments/stripe/handlers/invoicePaid";
import { handleChargeRefunded } from "@/lib/payments/stripe/handlers/chargeRefunded";
import { handleChargeDisputeCreated } from "@/lib/payments/stripe/handlers/chargeDisputeCreated";
import { handleChargeDisputeClosed } from "@/lib/payments/stripe/handlers/chargeDisputeClosed";
import { handleSubscriptionDeleted } from "@/lib/payments/stripe/handlers/subscriptionDeleted";

type HandledEvent = (typeof REQUIRED_STRIPE_WEBHOOK_EVENTS)[number];

// Keyed by exactly the events the webhook is subscribed to, so the compiler
// refuses a handler without its event in the list, or an event without its
// handler.
const HANDLERS: Record<HandledEvent, (merchant: Merchant, object: never) => Promise<void>> = {
  // Both go through one handler, which only creates a commission once the
  // Session says it is paid. A delayed payment method completes the Session
  // unpaid and the second event arrives when the money does; whichever lands
  // first on a paid Session wins, the other dedupes.
  "checkout.session.completed": handleCheckoutSessionCompleted,
  "checkout.session.async_payment_succeeded": handleCheckoutSessionCompleted,
  "invoice.paid": handleInvoicePaid,
  "charge.refunded": handleChargeRefunded,
  // An open dispute holds the commission; its close releases or voids it.
  "charge.dispute.created": handleChargeDisputeCreated,
  "charge.dispute.closed": handleChargeDisputeClosed,
  "customer.subscription.deleted": handleSubscriptionDeleted,
};

export async function processStripeEvent(merchant: Merchant, payload: unknown): Promise<void> {
  const event = payload as Stripe.Event;
  // A Merchant's webhook endpoint may be subscribed to more event types than
  // Supaffi cares about: expected, not a failure.
  if (!Object.hasOwn(HANDLERS, event.type)) return;
  const handler = HANDLERS[event.type as HandledEvent] as (merchant: Merchant, object: unknown) => Promise<void>;
  return handler(merchant, event.data.object);
}
