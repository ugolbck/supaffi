import { describe, it, expect, vi } from "vitest";
import type { Affiliate } from "@prisma/client";
import {
  checkSelfReferralEmail,
  checkPaymentMethodOverlap,
  resolveInvoiceFingerprint,
} from "@/lib/worker/selfReferral";

function affiliateFixture(overrides: Partial<Affiliate> = {}): Affiliate {
  return {
    id: "aff_1",
    merchantId: "merch_1",
    programId: "prog_1",
    email: "sarah@example.com",
    name: null,
    customCommissionRate: null,
    payoutDetails: null,
    createdAt: new Date(),
    ...overrides,
  } as Affiliate;
}

describe("checkSelfReferralEmail", () => {
  it("flags a match, keyed with the raw buyer email and the affiliate's stored email", () => {
    const affiliate = affiliateFixture({ email: "sarah@example.com" });
    expect(checkSelfReferralEmail(affiliate, "sarah@example.com")).toBe(
      "email:sarah@example.com sarah@example.com"
    );
  });

  it("matches case-insensitively but keeps the raw buyer email in the token", () => {
    const affiliate = affiliateFixture({ email: "sarah@example.com" });
    expect(checkSelfReferralEmail(affiliate, "Sarah@Example.com")).toBe(
      "email:Sarah@Example.com sarah@example.com"
    );
  });

  it("returns null when the emails differ", () => {
    const affiliate = affiliateFixture({ email: "sarah@example.com" });
    expect(checkSelfReferralEmail(affiliate, "buyer@example.com")).toBeNull();
  });

  it("returns null when there is no buyer email", () => {
    const affiliate = affiliateFixture({ email: "sarah@example.com" });
    expect(checkSelfReferralEmail(affiliate, null)).toBeNull();
  });
});

describe("checkPaymentMethodOverlap", () => {
  function stripeStub(opts: {
    customers: { id: string }[];
    fingerprintsByCustomer: Record<string, string[]>;
  }) {
    return {
      customers: {
        list: vi.fn(async () => ({ data: opts.customers })),
      },
      paymentMethods: {
        list: vi.fn(async ({ customer }: { customer: string }) => ({
          data: (opts.fingerprintsByCustomer[customer] ?? []).map((fp) => ({ card: { fingerprint: fp } })),
        })),
      },
    };
  }

  it("returns null when there is no buyer fingerprint to check", async () => {
    const affiliate = affiliateFixture();
    const stripe = stripeStub({ customers: [], fingerprintsByCustomer: {} });
    expect(await checkPaymentMethodOverlap(stripe as never, affiliate, null, "cus_buyer")).toBeNull();
    expect(stripe.customers.list).not.toHaveBeenCalled();
  });

  it("returns 'card' when a Stripe Customer sharing the affiliate's email carries the buyer's card", async () => {
    const affiliate = affiliateFixture({ email: "sarah@example.com" });
    const stripe = stripeStub({
      customers: [{ id: "cus_affiliate" }],
      fingerprintsByCustomer: { cus_affiliate: ["fp_shared"] },
    });
    const result = await checkPaymentMethodOverlap(stripe as never, affiliate, "fp_shared", "cus_buyer");
    expect(result).toBe("card");
  });

  it("skips the buyer's own Customer id rather than flagging them against themselves", async () => {
    const affiliate = affiliateFixture({ email: "sarah@example.com" });
    const stripe = stripeStub({
      customers: [{ id: "cus_buyer" }],
      fingerprintsByCustomer: { cus_buyer: ["fp_shared"] },
    });
    const result = await checkPaymentMethodOverlap(stripe as never, affiliate, "fp_shared", "cus_buyer");
    expect(result).toBeNull();
  });

  it("returns null when no candidate Customer carries a matching fingerprint", async () => {
    const affiliate = affiliateFixture({ email: "sarah@example.com" });
    const stripe = stripeStub({
      customers: [{ id: "cus_affiliate" }],
      fingerprintsByCustomer: { cus_affiliate: ["fp_other"] },
    });
    const result = await checkPaymentMethodOverlap(stripe as never, affiliate, "fp_shared", "cus_buyer");
    expect(result).toBeNull();
  });

  it("returns null and does not throw when the Stripe call fails", async () => {
    const affiliate = affiliateFixture();
    const stripe = {
      customers: { list: vi.fn(async () => { throw new Error("network"); }) },
      paymentMethods: { list: vi.fn() },
    };
    const result = await checkPaymentMethodOverlap(stripe as never, affiliate, "fp_shared", "cus_buyer");
    expect(result).toBeNull();
  });
});

describe("resolveInvoiceFingerprint", () => {
  it("reads the card behind the payment that paid the invoice", async () => {
    const list = vi.fn(async () => ({ data: [{ payment: { type: "payment_intent", payment_intent: "pi_1" } }] }));
    const retrieve = vi.fn(async () => ({ id: "pi_1", payment_method: { id: "pm_1", card: { fingerprint: "fp_1" } } }));
    const stripe = { invoicePayments: { list }, paymentIntents: { retrieve } };

    expect(await resolveInvoiceFingerprint(stripe as never, "in_1")).toBe("fp_1");
    expect(list).toHaveBeenCalledWith({ invoice: "in_1", status: "paid", limit: 1 });
    expect(retrieve).toHaveBeenCalledWith("pi_1", { expand: ["payment_method"] });
  });

  it("returns null when the invoice has no payment on record", async () => {
    const stripe = {
      invoicePayments: { list: vi.fn(async () => ({ data: [] })) },
      paymentIntents: { retrieve: vi.fn() },
    };
    expect(await resolveInvoiceFingerprint(stripe as never, "in_1")).toBeNull();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("returns null and does not throw when Stripe fails", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stripe = {
      invoicePayments: { list: vi.fn(async () => { throw new Error("network"); }) },
      paymentIntents: { retrieve: vi.fn() },
    };
    try {
      expect(await resolveInvoiceFingerprint(stripe as never, "in_1")).toBeNull();
      expect(warnings).toHaveBeenCalledTimes(1);
      expect(warnings.mock.calls[0][0]).toContain("in_1");
    } finally {
      warnings.mockRestore();
    }
  });
});
