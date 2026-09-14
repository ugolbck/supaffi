import { describe, it, expect } from "vitest";
import { REQUIRED_STRIPE_WEBHOOK_EVENTS } from "@/lib/stripeWebhookEvents";

describe("REQUIRED_STRIPE_WEBHOOK_EVENTS", () => {
  it("lists exactly the event types the webhook dispatcher handles", () => {
    expect(REQUIRED_STRIPE_WEBHOOK_EVENTS).toEqual([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "invoice.paid",
      "charge.refunded",
      "charge.dispute.created",
      "charge.dispute.closed",
      "customer.subscription.deleted",
    ]);
  });
});
