import type { Merchant } from "@prisma/client";
import { POLAR_WEBHOOK_EVENTS } from "@/lib/payments/polar/webhookEvents";
import { handleOrderPaid } from "@/lib/payments/polar/handlers/orderPaid";
import { handleOrderRefunded } from "@/lib/payments/polar/handlers/orderRefunded";
import { handleSubscriptionRevoked } from "@/lib/payments/polar/handlers/subscriptionRevoked";
import type { PolarEvent } from "@/lib/payments/polar/types";

type HandledEvent = (typeof POLAR_WEBHOOK_EVENTS)[number];

// Keyed by exactly the events the webhook is created with, so the compiler
// keeps the two in step.
const HANDLERS: Record<HandledEvent, (merchant: Merchant, data: never) => Promise<void>> = {
  "order.paid": handleOrderPaid,
  "order.refunded": handleOrderRefunded,
  "subscription.revoked": handleSubscriptionRevoked,
};

export async function processPolarEvent(merchant: Merchant, payload: unknown): Promise<void> {
  const event = payload as PolarEvent;
  if (!Object.hasOwn(HANDLERS, event.type)) return;
  const handler = HANDLERS[event.type as HandledEvent] as (merchant: Merchant, data: unknown) => Promise<void>;
  return handler(merchant, event.data);
}
