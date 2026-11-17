import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";
import { NextRequest } from "next/server";

// The database and decryption are stood in for: this suite is about what the
// route does with a signature, not about storage, which the worker suites
// already cover against a real database.
const findUnique = vi.fn();
const create = vi.fn();
// The route looks the product up with findFirst; the mock keeps its old name.
vi.mock("@/lib/db", () => ({ db: { merchant: { findFirst: findUnique }, webhookEvent: { create } } }));
vi.mock("@/lib/crypto", () => ({ decrypt: (value: string) => value }));

const { POST } = await import("@/app/api/webhooks/[provider]/route");
const { shouldLogSignatureFailure } = await import("@/lib/webhookSignatureLog");

const HOST = "affiliates.example.com";
const SECRET = "whsec_route_test";
const MINUTE = 60_000;
// The route's own limit. A route file may only export its handlers.
const MAX_WEBHOOK_BYTES = 1024 * 1024;

function payload(id: string): string {
  return JSON.stringify({ id, object: "event", type: "invoice.paid", created: 1_700_000_000, data: { object: {} } });
}

function request(body: string, signature: string, provider = "stripe"): NextRequest {
  return new NextRequest(`https://${HOST}/api/webhooks/${provider}`, {
    method: "POST",
    headers: { host: HOST, "stripe-signature": signature },
    body,
  });
}

function post(req: NextRequest, provider = "stripe") {
  return POST(req, { params: Promise.resolve({ provider }) });
}

function signed(body: string, secret = SECRET): string {
  return Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
}

describe("POST /api/webhooks/[provider] signature handling", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  // A fresh product id per test, because the log limiter is process-wide and
  // would otherwise carry state from one test into the next.
  let merchantId: string;

  beforeEach(() => {
    merchantId = `m_${crypto.randomUUID()}`;
    findUnique.mockReset();
    create.mockReset();
    findUnique.mockResolvedValue({ id: merchantId, paymentProvider: "STRIPE", webhookSecretEnc: SECRET });
    create.mockResolvedValue({});
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("queues a correctly signed event without logging", async () => {
    const body = payload("evt_ok");
    const response = await post(request(body, signed(body)));
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects bad signatures, never queues them, and logs one line for several", async () => {
    const body = payload("evt_bad");
    const wrong = signed(body, "whsec_other");

    for (let i = 0; i < 3; i++) {
      const response = await post(request(body, wrong));
      expect(response.status).toBe(400);
    }

    expect(create).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain(merchantId);
    expect(line).not.toContain("—");
    // Anyone can post here, so the log must not claim the secret is wrong.
    expect(line).not.toMatch(/does not match|is wrong|incorrect/i);
  });

  it("refuses a body over the size limit before verifying or storing it", async () => {
    const body = "x".repeat(MAX_WEBHOOK_BYTES + 1);
    const response = await post(request(body, signed(body)));
    expect(response.status).toBe(413);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses an oversized body that announces no length", async () => {
    const chunk = new Uint8Array(64 * 1024).fill(120);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
        if (sent > MAX_WEBHOOK_BYTES * 4) controller.close();
      },
    });
    // A stream body needs duplex, which Next's own RequestInit type leaves out.
    const init = { method: "POST", headers: { host: HOST, "stripe-signature": "t=1,v1=x" }, body: stream, duplex: "half" };
    const req = new NextRequest(`https://${HOST}/api/webhooks/stripe`, init as ConstructorParameters<typeof NextRequest>[1]);
    const response = await post(req);
    expect(response.status).toBe(413);
    // Stopped soon after the limit, not at the end of the stream.
    expect(sent).toBeLessThanOrEqual(MAX_WEBHOOK_BYTES + 3 * chunk.byteLength);
    expect(create).not.toHaveBeenCalled();
  });

  it("answers 404 for an address that names no provider, without reading the body", async () => {
    const body = payload("evt_unknown");
    const response = await post(request(body, signed(body), "paypal"), "paypal");
    expect(response.status).toBe(404);
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("turns away a request with no signature before looking anything up", async () => {
    // The console spy outlives a test, so the earlier rejection's line is cleared.
    warn.mockClear();
    const req = new NextRequest(`https://${HOST}/api/webhooks/stripe`, {
      method: "POST",
      headers: { host: HOST },
      body: payload("evt_unsigned"),
    });
    const response = await post(req);
    expect(response.status).toBe(400);
    expect(findUnique).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("stores the provider's event id and the verified payload", async () => {
    const body = payload("evt_stored");
    await post(request(body, signed(body)));
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ merchantId, providerEventId: "evt_stored", payload: expect.objectContaining({ id: "evt_stored" }) }),
    });
  });
});

describe("shouldLogSignatureFailure", () => {
  it("logs the first rejection, then at most once every 15 minutes", () => {
    const merchant = `m_${crypto.randomUUID()}`;
    const start = 1_000_000;
    expect(shouldLogSignatureFailure(merchant, start)).toBe(true);
    expect(shouldLogSignatureFailure(merchant, start + MINUTE)).toBe(false);
    expect(shouldLogSignatureFailure(merchant, start + 15 * MINUTE)).toBe(true);
  });

  it("limits each product on its own", () => {
    const a = `m_${crypto.randomUUID()}`;
    const b = `m_${crypto.randomUUID()}`;
    expect(shouldLogSignatureFailure(a, 0)).toBe(true);
    expect(shouldLogSignatureFailure(b, 1)).toBe(true);
  });
});
