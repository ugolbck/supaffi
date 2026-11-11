import { describe, it, expect, vi } from "vitest";
import type { Merchant } from "@prisma/client";
import type { PaymentProviderAdapter } from "@/lib/payments/types";

/**
 * What every payment provider's adapter has to do, run once per provider by
 * its own test file. A new provider passes this before it ships.
 */
export type ProviderContractFixtures = {
  /** Headers that sign `body` with `secret` the way the provider does. */
  sign(body: string, secret: string): Headers;
  /** A delivery of an event the adapter does not handle, with its event id. */
  unhandledEvent: { body: string; eventId: string };
  /** An error as the provider's SDK throws it, whose message names `secretText`. */
  providerError: unknown;
  secretText: string;
};

const SECRET = "contract_test_secret_0123456789abcdef";

export function describeProviderContract(adapter: PaymentProviderAdapter, fixtures: ProviderContractFixtures): void {
  describe(`${adapter.name} payment provider contract`, () => {
    it("has an address segment that is safe in a URL", () => {
      expect(adapter.webhookSlug).toMatch(/^[a-z0-9-]+$/);
    });

    it("verifies a correctly signed delivery and keeps the provider's event id", () => {
      const { body, eventId } = fixtures.unhandledEvent;
      const headers = fixtures.sign(body, SECRET);
      // The route turns a request away before any lookup when this header is missing.
      expect(headers.get(adapter.signatureHeader)).toBeTruthy();
      const verified = adapter.verifyWebhook({ rawBody: body, headers, secret: SECRET });
      expect(verified?.eventId).toBe(eventId);
      expect(verified?.payload).toEqual(JSON.parse(body));
    });

    it("rejects a delivery signed with another secret, a changed body, or no signature", () => {
      const { body } = fixtures.unhandledEvent;
      expect(adapter.verifyWebhook({ rawBody: body, headers: fixtures.sign(body, "another_secret_0123456789"), secret: SECRET })).toBeNull();
      expect(adapter.verifyWebhook({ rawBody: `${body} `, headers: fixtures.sign(body, SECRET), secret: SECRET })).toBeNull();
      expect(adapter.verifyWebhook({ rawBody: body, headers: new Headers(), secret: SECRET })).toBeNull();
    });

    it("lists each handled event once", () => {
      expect(adapter.handledEvents.length).toBeGreaterThan(0);
      expect(new Set(adapter.handledEvents).size).toBe(adapter.handledEvents.length);
    });

    it("ignores an event it does not handle", async () => {
      const { body } = fixtures.unhandledEvent;
      const merchant = { id: "m_contract", paymentProvider: adapter.id } as Merchant;
      await expect(adapter.processEvent(merchant, JSON.parse(body))).resolves.toBeUndefined();
    });

    it("labels its own errors without their message, and nothing else", () => {
      const label = adapter.errorLabel(fixtures.providerError);
      expect(label).toBeTruthy();
      expect(label).not.toContain(fixtures.secretText);
      expect(adapter.errorLabel(new Error("a bug in Supaffi"))).toBeNull();
      expect(adapter.errorLabel(undefined)).toBeNull();
    });

    it("moves and upgrades its webhook without throwing, when it can", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        if (adapter.moveWebhookEndpoint) {
          await expect(adapter.moveWebhookEndpoint("m_missing_contract")).resolves.toMatch(/^(moved|manual|none)$/);
        }
      } finally {
        error.mockRestore();
        warn.mockRestore();
      }
    });
  });
}
