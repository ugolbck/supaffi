import { describe, it, expect } from "vitest";
import { isTransientStripeError, loggableError, stripeErrorLabel } from "@/lib/stripeErrors";

describe("isTransientStripeError", () => {
  it("retries outages, rate limits and dropped connections", () => {
    expect(isTransientStripeError({ type: "StripeConnectionError" })).toBe(true);
    expect(isTransientStripeError({ type: "StripeAPIError", statusCode: 500 })).toBe(true);
    expect(isTransientStripeError({ type: "StripeRateLimitError", statusCode: 429 })).toBe(true);
    expect(isTransientStripeError({ type: "StripeInvalidRequestError", statusCode: 503 })).toBe(true);
  });

  it("falls back on a key that cannot read something", () => {
    expect(isTransientStripeError({ type: "StripePermissionError", statusCode: 403 })).toBe(false);
    expect(isTransientStripeError({ type: "StripeInvalidRequestError", statusCode: 400 })).toBe(false);
    expect(isTransientStripeError(new Error("bug"))).toBe(false);
    expect(isTransientStripeError(undefined)).toBe(false);
  });
});

describe("loggableError", () => {
  it("never carries Stripe's own message", () => {
    const err = Object.assign(new Error("Invalid API Key provided: rk_live_****abcd on acct_secret123"), {
      type: "StripeAuthenticationError",
      code: "api_key_invalid",
    });
    expect(loggableError(err)).toBe("Stripe error StripeAuthenticationError/api_key_invalid");
    expect(stripeErrorLabel(err)).not.toContain("acct_secret123");
  });

  it("keeps the message of an error that is not Stripe's", () => {
    expect(loggableError(new Error("invoice in_1 is open, not paid yet"))).toBe("invoice in_1 is open, not paid yet");
  });
});
