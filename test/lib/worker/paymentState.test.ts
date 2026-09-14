import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import {
  commissionFieldsAtCreation,
  disputeStateAtCreation,
  latestChargeFor,
  paymentIntentForInvoice,
  type ChargeSnapshot,
} from "@/lib/worker/paymentState";

/** A charge as `latestChargeFor` reports it, undisputed unless said. */
function snapshot(amountRefunded: number, disputed = false): ChargeSnapshot {
  return { amount: 5000, amountRefunded, disputed };
}

describe("commissionFieldsAtCreation", () => {
  const amount = new Prisma.Decimal(10);
  const now = new Date("2026-09-13T12:00:00Z");

  it("starts pending at the full amount when nothing was refunded", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: null, charge: snapshot(0), now });
    expect(fields.amount.toString()).toBe("10");
    expect(fields.grossAmount.toString()).toBe("10");
    expect(fields.status).toBe("PENDING");
    expect(fields.voidedAt).toBeNull();
    expect(fields.voidReason).toBeNull();
    expect(fields.disputeOpenedAt).toBeNull();
  });

  it("starts pending at the full amount when the charge could not be read", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: null, charge: null, now });
    expect(fields.amount.toString()).toBe("10");
    expect(fields.status).toBe("PENDING");
    expect(fields.disputeOpenedAt).toBeNull();
  });

  it("starts flagged when a self referral was spotted", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: "card", charge: null, now });
    expect(fields.status).toBe("FLAGGED");
  });

  it("starts reduced when part of the sale was already refunded, keeping the original as gross", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: null, charge: snapshot(2500), now });
    expect(fields.amount.toString()).toBe("5");
    expect(fields.grossAmount.toString()).toBe("10");
    expect(fields.status).toBe("PENDING");
    expect(fields.voidReason).toBe("partial refund");
    expect(fields.voidedAt).toBeNull();
  });

  it("keeps a flag when a partial refund is folded in, as the refund handler does", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: "card", charge: snapshot(2500), now });
    expect(fields.status).toBe("FLAGGED");
    expect(fields.amount.toString()).toBe("5");
  });

  it("starts voided when the whole sale was already refunded", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: null, charge: snapshot(5000), now });
    expect(fields.status).toBe("VOIDED");
    expect(fields.voidReason).toBe("refund");
    expect(fields.voidedAt).toEqual(now);
    expect(fields.grossAmount.toString()).toBe("10");
  });

  it("starts held when the sale is under an open dispute, or one that could not be read", () => {
    for (const dispute of ["open", "unknown"] as const) {
      const fields = commissionFieldsAtCreation({ amount, flagReason: null, charge: snapshot(0, true), dispute, now });
      expect(fields.status).toBe("PENDING");
      expect(fields.disputeOpenedAt).toEqual(now);
      expect(fields.amount.toString()).toBe("10");
    }
  });

  it("keeps a flag and a partial refund while holding", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: "card", charge: snapshot(2500, true), dispute: "open", now });
    expect(fields.status).toBe("FLAGGED");
    expect(fields.amount.toString()).toBe("5");
    expect(fields.voidReason).toBe("partial refund");
    expect(fields.disputeOpenedAt).toEqual(now);
  });

  it("starts voided as a chargeback when a dispute on the sale was already lost", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: null, charge: snapshot(0, true), dispute: "lost", now });
    expect(fields.status).toBe("VOIDED");
    expect(fields.voidReason).toBe("chargeback");
    expect(fields.voidedAt).toEqual(now);
    expect(fields.disputeOpenedAt).toBeNull();
  });

  it("records a full refund as the cause even when a dispute was lost too", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: null, charge: snapshot(5000, true), dispute: "lost", now });
    expect(fields.status).toBe("VOIDED");
    expect(fields.voidReason).toBe("refund");
  });

  it("starts untouched when every dispute closed in the merchant's favour", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: null, charge: snapshot(0, true), dispute: "clear", now });
    expect(fields.status).toBe("PENDING");
    expect(fields.disputeOpenedAt).toBeNull();
  });
});

describe("disputeStateAtCreation", () => {
  it("checks nothing when the charge was not read", async () => {
    const list = vi.fn();
    const stripe = { disputes: { list } } as unknown as Stripe;
    expect(await disputeStateAtCreation(stripe, "pi_1", null)).toBeNull();
    expect(await disputeStateAtCreation(stripe, null, snapshot(0, true))).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("answers clear without a request when the charge was never disputed", async () => {
    const list = vi.fn();
    const stripe = { disputes: { list } } as unknown as Stripe;
    expect(await disputeStateAtCreation(stripe, "pi_1", snapshot(0))).toBe("clear");
    expect(list).not.toHaveBeenCalled();
  });

  it("lists the disputes when the charge was disputed", async () => {
    const list = vi.fn(async () => ({ data: [{ id: "dp_1", status: "lost" }] }));
    const stripe = { disputes: { list } } as unknown as Stripe;
    expect(await disputeStateAtCreation(stripe, "pi_1", snapshot(0, true))).toBe("lost");
    expect(list).toHaveBeenCalledWith({ payment_intent: "pi_1", limit: 100 });
  });
});

describe("Stripe lookups", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the refund off the payment's latest charge", async () => {
    const retrieve = vi.fn(async () => ({ id: "pi_1", latest_charge: { id: "ch_1", amount: 5000, amount_refunded: 1200, disputed: true } }));
    const stripe = { paymentIntents: { retrieve } } as unknown as Stripe;

    expect(await latestChargeFor(stripe, "pi_1")).toEqual({ amount: 5000, amountRefunded: 1200, disputed: true });
    expect(retrieve).toHaveBeenCalledWith("pi_1", { expand: ["latest_charge"] });
  });

  // A key without Charges read is not guaranteed to get a permission error:
  // Stripe can answer with an invalid request instead. The lookup must not
  // depend on which, so both shapes are tried.
  it.each([
    Object.assign(new Error("permission"), { type: "StripePermissionError", statusCode: 403 }),
    Object.assign(new Error("invalid request"), { type: "StripeInvalidRequestError", statusCode: 400 }),
  ])("answers unknown, without throwing, whatever error the lookup fails with (%s)", async (failure) => {
    const stripe = { paymentIntents: { retrieve: vi.fn(async () => { throw failure; }) } } as unknown as Stripe;

    expect(await latestChargeFor(stripe, "pi_1")).toBeNull();
  });

  it("answers unknown when Stripe returns the charge unexpanded", async () => {
    const stripe = { paymentIntents: { retrieve: vi.fn(async () => ({ id: "pi_1", latest_charge: "ch_1" })) } } as unknown as Stripe;
    expect(await latestChargeFor(stripe, "pi_1")).toBeNull();
  });

  it("finds the payment behind a paid invoice", async () => {
    const list = vi.fn(async () => ({ data: [{ payment: { type: "payment_intent", payment_intent: "pi_2" } }] }));
    const stripe = { invoicePayments: { list } } as unknown as Stripe;

    expect(await paymentIntentForInvoice(stripe, "in_1")).toBe("pi_2");
    expect(list).toHaveBeenCalledWith({ invoice: "in_1", status: "paid", limit: 1 });
  });

  it("answers unknown for an invoice with no payment, or when the lookup fails", async () => {
    const empty = { invoicePayments: { list: vi.fn(async () => ({ data: [] })) } } as unknown as Stripe;
    const failing = { invoicePayments: { list: vi.fn(async () => { throw new Error("down"); }) } } as unknown as Stripe;

    expect(await paymentIntentForInvoice(empty, "in_1")).toBeNull();
    expect(await paymentIntentForInvoice(failing, "in_1")).toBeNull();
  });
});
