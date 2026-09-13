import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import {
  commissionFieldsAtCreation,
  latestChargeFor,
  paymentIntentForInvoice,
} from "@/lib/worker/paymentState";

describe("commissionFieldsAtCreation", () => {
  const amount = new Prisma.Decimal(10);
  const now = new Date("2026-09-13T12:00:00Z");

  it("starts pending at the full amount when nothing was refunded", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: null, charge: { amount: 5000, amountRefunded: 0 }, now });
    expect(fields.amount.toString()).toBe("10");
    expect(fields.grossAmount.toString()).toBe("10");
    expect(fields.status).toBe("PENDING");
    expect(fields.voidedAt).toBeNull();
    expect(fields.voidReason).toBeNull();
  });

  it("starts pending at the full amount when the charge could not be read", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: null, charge: null, now });
    expect(fields.amount.toString()).toBe("10");
    expect(fields.status).toBe("PENDING");
  });

  it("starts flagged when a self referral was spotted", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: "card", charge: null, now });
    expect(fields.status).toBe("FLAGGED");
  });

  it("starts reduced when part of the sale was already refunded, keeping the original as gross", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: null, charge: { amount: 5000, amountRefunded: 2500 }, now });
    expect(fields.amount.toString()).toBe("5");
    expect(fields.grossAmount.toString()).toBe("10");
    expect(fields.status).toBe("PENDING");
    expect(fields.voidReason).toBe("partial refund");
    expect(fields.voidedAt).toBeNull();
  });

  it("keeps a flag when a partial refund is folded in, as the refund handler does", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: "card", charge: { amount: 5000, amountRefunded: 2500 }, now });
    expect(fields.status).toBe("FLAGGED");
    expect(fields.amount.toString()).toBe("5");
  });

  it("starts voided when the whole sale was already refunded", () => {
    const fields = commissionFieldsAtCreation({ amount, flagReason: null, charge: { amount: 5000, amountRefunded: 5000 }, now });
    expect(fields.status).toBe("VOIDED");
    expect(fields.voidReason).toBe("refund");
    expect(fields.voidedAt).toEqual(now);
    expect(fields.grossAmount.toString()).toBe("10");
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
    const retrieve = vi.fn(async () => ({ id: "pi_1", latest_charge: { id: "ch_1", amount: 5000, amount_refunded: 1200 } }));
    const stripe = { paymentIntents: { retrieve } } as unknown as Stripe;

    expect(await latestChargeFor(stripe, "pi_1")).toEqual({ amount: 5000, amountRefunded: 1200 });
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
