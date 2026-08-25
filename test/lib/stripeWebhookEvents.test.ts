import { describe, it, expect } from "vitest";
import { REQUIRED_STRIPE_WEBHOOK_EVENTS } from "@/lib/stripeWebhookEvents";

describe("REQUIRED_STRIPE_WEBHOOK_EVENTS", () => {
  it("lists exactly the four event types the webhook dispatcher handles", () => {
    expect(REQUIRED_STRIPE_WEBHOOK_EVENTS).toEqual([
      "checkout.session.completed",
      "invoice.paid",
      "charge.refunded",
      "customer.subscription.deleted",
    ]);
  });
});
