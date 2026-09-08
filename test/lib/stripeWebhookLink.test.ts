import { describe, it, expect } from "vitest";
import { webhookCreateUrl, webhookEndpointUrl, WEBHOOK_EVENTS } from "@/lib/stripeWebhookLink";

describe("webhook link", () => {
  it("points Stripe at this product's endpoint", () => {
    expect(webhookEndpointUrl("affiliates.instantgradient.com")).toBe(
      "https://affiliates.instantgradient.com/api/webhooks/stripe"
    );
  });

  it("prefills the endpoint and every event the worker handles", () => {
    const url = new URL(webhookCreateUrl("affiliates.instantgradient.com"));
    expect(url.origin + url.pathname).toBe("https://dashboard.stripe.com/webhooks/create");
    expect(url.searchParams.get("endpoint_location")).toBe("https://affiliates.instantgradient.com/api/webhooks/stripe");
    expect(url.searchParams.getAll("events[]")).toEqual([...WEBHOOK_EVENTS]);
  });
});
