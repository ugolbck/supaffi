import { describe, it, expect } from "vitest";
import { PaymentProvider } from "@prisma/client";
import { loggableError, paymentProviderBySlug, paymentProviderFor, paymentProviders } from "@/lib/payments";

describe("payment provider registry", () => {
  it("has an adapter for every provider a product can store", () => {
    for (const id of Object.values(PaymentProvider)) {
      expect(paymentProviderFor({ paymentProvider: id }).id).toBe(id);
    }
  });

  it("finds a provider by its webhook address segment, and none for an unknown one", () => {
    for (const provider of paymentProviders) {
      expect(paymentProviderBySlug(provider.webhookSlug)).toBe(provider);
    }
    expect(paymentProviderBySlug("paypal")).toBeNull();
    expect(new Set(paymentProviders.map((p) => p.webhookSlug)).size).toBe(paymentProviders.length);
  });

  it("logs a provider's error by its label and anything else by its message", () => {
    expect(loggableError({ type: "StripePermissionError", code: "x", message: "acct_secret" })).toBe("Stripe error StripePermissionError/x");
    expect(loggableError(new Error("invoice in_1 is open, not paid yet"))).toBe("invoice in_1 is open, not paid yet");
  });
});
