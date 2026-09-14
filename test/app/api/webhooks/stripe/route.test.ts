import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";
import { NextRequest } from "next/server";

// The database and decryption are stood in for: this suite is about what the
// route does with a signature, not about storage, which the worker suites
// already cover against a real database.
const findUnique = vi.fn();
const create = vi.fn();
vi.mock("@/lib/db", () => ({ db: { merchant: { findUnique }, webhookEvent: { create } } }));
vi.mock("@/lib/crypto", () => ({ decrypt: (value: string) => value }));

const { POST } = await import("@/app/api/webhooks/stripe/route");
const { shouldLogSignatureFailure } = await import("@/lib/webhookSignatureLog");

const HOST = "affiliates.example.com";
const SECRET = "whsec_route_test";
const MINUTE = 60_000;

function payload(id: string): string {
  return JSON.stringify({ id, object: "event", type: "invoice.paid", created: 1_700_000_000, data: { object: {} } });
}

function request(body: string, signature: string): NextRequest {
  return new NextRequest(`https://${HOST}/api/webhooks/stripe`, {
    method: "POST",
    headers: { host: HOST, "stripe-signature": signature },
    body,
  });
}

function signed(body: string, secret = SECRET): string {
  return Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
}

describe("POST /api/webhooks/stripe signature handling", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  // A fresh product id per test, because the log limiter is process-wide and
  // would otherwise carry state from one test into the next.
  let merchantId: string;

  beforeEach(() => {
    merchantId = `m_${crypto.randomUUID()}`;
    findUnique.mockReset();
    create.mockReset();
    findUnique.mockResolvedValue({ id: merchantId, stripeWebhookSecretEnc: SECRET });
    create.mockResolvedValue({});
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("queues a correctly signed event without logging", async () => {
    const body = payload("evt_ok");
    const response = await POST(request(body, signed(body)));
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects bad signatures, never queues them, and logs one line for several", async () => {
    const body = payload("evt_bad");
    const wrong = signed(body, "whsec_other");

    for (let i = 0; i < 3; i++) {
      const response = await POST(request(body, wrong));
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
