import { describe, it, expect, vi, type Mock } from "vitest";
import {
  ensureRequiredWebhookEvents,
  type WebhookEndpointsClient,
} from "@/lib/stripeWebhookEndpoint";
import { REQUIRED_STRIPE_WEBHOOK_EVENTS } from "@/lib/stripeWebhookEvents";

const URL = "https://affiliates.example.com/api/webhooks/stripe";

// The event list an endpoint created by the previous release carries.
const OLD_EVENTS = ["checkout.session.completed", "invoice.paid", "charge.refunded", "customer.subscription.deleted"];

function stripeError(type: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(type), { type, ...extra });
}

// Every method is a Mock, so a test can read back what was sent to Stripe.
type FakeClient = { webhookEndpoints: { retrieve: Mock; list: Mock; update: Mock } };

function fakeClient(overrides: Partial<FakeClient["webhookEndpoints"]> = {}): FakeClient & WebhookEndpointsClient {
  return {
    webhookEndpoints: {
      retrieve: vi.fn(async (id: string) => ({ id, url: URL, enabled_events: OLD_EVENTS })),
      list: vi.fn(async () => ({ data: [] })),
      update: vi.fn(async () => ({})),
      ...overrides,
    },
  };
}

describe("ensureRequiredWebhookEvents", () => {
  it("adds the missing events to a stored endpoint and keeps the extras", async () => {
    const client = fakeClient({
      retrieve: vi.fn(async (id: string) => ({ id, url: URL, enabled_events: [...OLD_EVENTS, "customer.created"] })),
    });
    const result = await ensureRequiredWebhookEvents(client, { endpointId: "we_1", url: URL });

    expect(result).toEqual({ status: "updated" });
    expect(client.webhookEndpoints.update).toHaveBeenCalledTimes(1);
    const [id, params] = client.webhookEndpoints.update.mock.calls[0];
    expect(id).toBe("we_1");
    expect(params.enabled_events).toEqual(expect.arrayContaining([...REQUIRED_STRIPE_WEBHOOK_EVENTS, "customer.created"]));
    expect(new Set(params.enabled_events).size).toBe(params.enabled_events.length);
    expect(client.webhookEndpoints.list).not.toHaveBeenCalled();
  });

  it("leaves an endpoint that already has every event alone", async () => {
    const client = fakeClient({
      retrieve: vi.fn(async (id: string) => ({ id, url: URL, enabled_events: [...REQUIRED_STRIPE_WEBHOOK_EVENTS] })),
    });
    expect(await ensureRequiredWebhookEvents(client, { endpointId: "we_1", url: URL })).toEqual({ status: "current" });
    expect(client.webhookEndpoints.update).not.toHaveBeenCalled();
  });

  it("leaves an endpoint listening to every event alone", async () => {
    const client = fakeClient({ retrieve: vi.fn(async (id: string) => ({ id, url: URL, enabled_events: ["*"] })) });
    expect(await ensureRequiredWebhookEvents(client, { endpointId: "we_1", url: URL })).toEqual({ status: "current" });
    expect(client.webhookEndpoints.update).not.toHaveBeenCalled();
  });

  it("finds the endpoint by its address when no id is stored", async () => {
    const client = fakeClient({
      list: vi.fn(async () => ({
        data: [
          { id: "we_other", url: "https://elsewhere.example.com/hook", enabled_events: ["invoice.paid"] },
          { id: "we_ours", url: URL, enabled_events: OLD_EVENTS },
        ],
      })),
    });
    expect(await ensureRequiredWebhookEvents(client, { endpointId: null, url: URL })).toEqual({ status: "updated" });
    expect(client.webhookEndpoints.update).toHaveBeenCalledTimes(1);
    expect(client.webhookEndpoints.update.mock.calls[0][0]).toBe("we_ours");
  });

  it("falls back to the address when the stored id is gone", async () => {
    const client = fakeClient({
      retrieve: vi.fn(async () => {
        throw stripeError("StripeInvalidRequestError", { code: "resource_missing", statusCode: 404 });
      }),
      list: vi.fn(async () => ({ data: [{ id: "we_new", url: URL, enabled_events: OLD_EVENTS }] })),
    });
    expect(await ensureRequiredWebhookEvents(client, { endpointId: "we_gone", url: URL })).toEqual({ status: "updated" });
    expect(client.webhookEndpoints.update.mock.calls[0][0]).toBe("we_new");
  });

  it("reports an endpoint that exists nowhere", async () => {
    const client = fakeClient({
      retrieve: vi.fn(async () => {
        throw stripeError("StripeInvalidRequestError", { code: "resource_missing", statusCode: 404 });
      }),
    });
    const result = await ensureRequiredWebhookEvents(client, { endpointId: "we_gone", url: URL });
    expect(result.status).toBe("missing");
  });

  it("reports a key that cannot change the endpoint", async () => {
    const client = fakeClient({
      update: vi.fn(async () => {
        throw stripeError("StripePermissionError", { statusCode: 403 });
      }),
    });
    const result = await ensureRequiredWebhookEvents(client, { endpointId: "we_1", url: URL });
    expect(result.status).toBe("permission");
  });

  it("reports anything else as an error without throwing", async () => {
    const client = fakeClient({
      retrieve: vi.fn(async () => {
        throw stripeError("StripeConnectionError");
      }),
    });
    const result = await ensureRequiredWebhookEvents(client, { endpointId: "we_1", url: URL });
    expect(result.status).toBe("error");
    expect(client.webhookEndpoints.list).not.toHaveBeenCalled();
  });
});
