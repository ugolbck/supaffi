import { describe, it, expect } from "vitest";
import Stripe from "stripe";
import { stripeProvider } from "@/lib/payments/stripe";
import { REQUIRED_STRIPE_WEBHOOK_EVENTS } from "@/lib/payments/stripe/webhookEvents";
import { describeProviderContract } from "./providerContract";

const unhandled = { id: "evt_contract", object: "event", type: "product.created", created: 1_700_000_000, data: { object: {} } };

describeProviderContract(stripeProvider, {
  sign: (body, secret) =>
    new Headers({ "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret }) }),
  unhandledEvent: { body: JSON.stringify(unhandled), eventId: "evt_contract" },
  providerError: { type: "StripeAuthenticationError", code: "api_key_invalid", message: "Invalid API Key provided: rk_live_secret" },
  secretText: "rk_live_secret",
});

describe("stripeProvider", () => {
  it("handles exactly the events its webhook is created with", () => {
    expect(stripeProvider.handledEvents).toEqual(REQUIRED_STRIPE_WEBHOOK_EVENTS);
  });

  it("links payments and invoices into the Stripe dashboard, and nothing else", () => {
    expect(stripeProvider.paymentUrl("pi_1")).toBe("https://dashboard.stripe.com/payments/pi_1");
    expect(stripeProvider.paymentUrl("in_1")).toBe("https://dashboard.stripe.com/invoices/in_1");
    expect(stripeProvider.paymentUrl("ch_1")).toBeNull();
  });
});
