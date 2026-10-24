import { describe, it, expect, vi, afterEach } from "vitest";
import { inspect } from "node:util";
import type Stripe from "stripe";
import { latestChargeFor, paymentIntentForInvoice } from "@/lib/worker/paymentState";
import { resolveInvoiceFingerprint } from "@/lib/worker/selfReferral";
import { disputeStateFor } from "@/lib/worker/disputes";

const outage = () => Object.assign(new Error("connection reset on acct_secret123"), { type: "StripeConnectionError" });
const noPermission = () =>
  Object.assign(new Error("rk_live_****abcd lacks rak_charge_read on acct_secret123"), {
    type: "StripePermissionError",
    statusCode: 403,
  });

function stripeFailing(err: () => Error): Stripe {
  const fail = vi.fn(async () => {
    throw err();
  });
  return {
    paymentIntents: { retrieve: fail },
    invoicePayments: { list: fail },
    disputes: { list: fail },
  } as unknown as Stripe;
}

afterEach(() => vi.restoreAllMocks());

describe("best-effort Stripe reads", () => {
  it("throw on an outage so the event is retried, without Stripe's message", async () => {
    const stripe = stripeFailing(outage);
    for (const read of [
      () => latestChargeFor(stripe, "pi_1"),
      () => paymentIntentForInvoice(stripe, "in_1"),
      () => resolveInvoiceFingerprint(stripe, "in_1"),
      () => disputeStateFor(stripe, "pi_1"),
    ]) {
      const thrown = await read().then(
        () => null,
        (err: Error) => err
      );
      expect(thrown?.message).toMatch(/retried/);
      expect(inspect(thrown)).not.toContain("acct_secret123");
    }
  });

  it("fall back on a key that cannot read, logging no raw message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stripe = stripeFailing(noPermission);

    expect(await latestChargeFor(stripe, "pi_1")).toBeNull();
    expect(await paymentIntentForInvoice(stripe, "in_1")).toBeNull();
    expect(await resolveInvoiceFingerprint(stripe, "in_1")).toBeNull();
    expect(await disputeStateFor(stripe, "pi_1")).toBe("unknown");
    expect(inspect(warn.mock.calls)).not.toContain("acct_secret123");
  });
});
