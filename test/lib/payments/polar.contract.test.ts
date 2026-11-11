import { describe, it, expect } from "vitest";
import { polarProvider } from "@/lib/payments/polar";
import { PolarApiError } from "@/lib/payments/polar/api";
import { POLAR_WEBHOOK_EVENTS } from "@/lib/payments/polar/webhookEvents";
import { verifyPolarSignature } from "@/lib/payments/polar/signature";
import { describeProviderContract } from "./providerContract";
import { polarHeaders, polarSecret } from "./polar/sign";

const unhandled = { type: "checkout.created", timestamp: "2026-11-11T09:00:00Z", data: { id: "co_1" } };

describeProviderContract(polarProvider, {
  sign: (body, secret) => polarHeaders(body, secret, { id: "msg_contract" }),
  unhandledEvent: { body: JSON.stringify(unhandled), eventId: "msg_contract" },
  providerError: new PolarApiError(401, "invalid_token"),
  secretText: "polar_oat_",
});

describe("polarProvider", () => {
  it("handles exactly the events its webhook is created with", () => {
    expect(polarProvider.handledEvents).toEqual(POLAR_WEBHOOK_EVENTS);
  });
});

describe("verifyPolarSignature", () => {
  const body = JSON.stringify({ type: "order.paid", data: {} });

  it("accepts a secret generated since 2026-09-08, keyed on its base64", () => {
    const secret = polarSecret();
    expect(verifyPolarSignature(body, polarHeaders(body, secret), secret)).toBe(true);
  });

  it("accepts an older secret, keyed on the whole string", () => {
    const secret = "whsec_abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    expect(verifyPolarSignature(body, polarHeaders(body, secret, { legacy: true }), secret)).toBe(true);
  });

  it("refuses a delivery more than five minutes old or ahead", () => {
    const secret = polarSecret();
    const now = Date.now();
    expect(verifyPolarSignature(body, polarHeaders(body, secret, { at: now - 6 * 60_000 }), secret, now)).toBe(false);
    expect(verifyPolarSignature(body, polarHeaders(body, secret, { at: now + 6 * 60_000 }), secret, now)).toBe(false);
    expect(verifyPolarSignature(body, polarHeaders(body, secret, { at: now - 4 * 60_000 }), secret, now)).toBe(true);
  });

  it("accepts any one of several signatures, as during a secret rotation", () => {
    const secret = polarSecret();
    const headers = polarHeaders(body, secret);
    headers.set("webhook-signature", `v1,bm90IGl0 ${headers.get("webhook-signature")}`);
    expect(verifyPolarSignature(body, headers, secret)).toBe(true);
  });
});
