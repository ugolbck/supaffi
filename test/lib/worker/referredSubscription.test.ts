// Destructive: clears Commission / ReferredSubscription / Click / AffiliateLink /
// Affiliate / Program / Merchant / Owner. Runs against the scratch DATABASE_URL
// that test/setup.ts enforces, never the dev one.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";

// Only reached when recognising a click linked before 0.2.5. Tests that expect
// a call queue a value; the rest assert nothing was asked.
const stripeStub = vi.hoisted(() => ({
  invoices: { retrieve: vi.fn(async (_id: string): Promise<unknown> => undefined) },
}));
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe")>("@/lib/stripe");
  return { ...actual, stripeClientFor: () => stripeStub as unknown as Stripe };
});

import { deleteMerchant } from "@/lib/merchant";
import {
  claimFirstPayment,
  findReferredSubscription,
  recordReferredSubscription,
  subscriptionIdOf,
} from "@/lib/worker/referredSubscription";
import {
  clearReferralTables,
  retrievedInvoice,
  seedInvoiceCommission,
  seedLegacyClick,
  seedMerchant,
  seedOwner,
  seedReferral,
  seedReferredSubscription,
  stripeError,
} from "./referralFixtures";

function invoiceWith(fields: Record<string, unknown>): Stripe.Invoice {
  return { id: "in_1", ...fields } as unknown as Stripe.Invoice;
}

/** Answers invoices.retrieve from a table, and resource_missing for anything else. */
function invoicesById(invoices: Array<ReturnType<typeof retrievedInvoice>>) {
  stripeStub.invoices.retrieve.mockImplementation(async (id: string) => {
    const found = invoices.find((invoice) => invoice.id === id);
    if (!found) throw stripeError("StripeInvalidRequestError", "resource_missing");
    return found;
  });
}

describe("subscriptionIdOf", () => {
  it("reads the subscription from parent on current API versions", () => {
    const invoice = invoiceWith({ parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } } });
    expect(subscriptionIdOf(invoice)).toBe("sub_1");
  });

  it("reads the top-level field webhook endpoints on versions before 2025-03-31.basil still send", () => {
    expect(subscriptionIdOf(invoiceWith({ subscription: "sub_1" }))).toBe("sub_1");
  });

  it("finds none on a one-off invoice", () => {
    expect(subscriptionIdOf(invoiceWith({ parent: null }))).toBeNull();
    expect(subscriptionIdOf(invoiceWith({ subscription: null }))).toBeNull();
  });
});

describe("referred subscriptions", () => {
  let ownerId: string;
  let merchant: Merchant;

  beforeEach(async () => {
    await clearReferralTables();
    stripeStub.invoices.retrieve.mockReset();
    ownerId = (await seedOwner()).id;
    merchant = await seedMerchant(ownerId);
  });

  afterAll(async () => {
    await clearReferralTables();
    await db.$disconnect();
  });

  it("go with the product when it is deleted", async () => {
    const { click } = await seedReferral(merchant);
    await seedReferredSubscription(merchant.id, click.id, "sub_1");

    await deleteMerchant(ownerId, merchant.id);

    expect(await db.referredSubscription.count()).toBe(0);
    expect(await db.merchant.count({ where: { id: merchant.id } })).toBe(0);
  });

  it("hold a subscription id once per product, so products sharing a Stripe account each keep theirs", async () => {
    const other = await seedMerchant(ownerId);
    const refA = await seedReferral(merchant);
    const refB = await seedReferral(other);

    await seedReferredSubscription(merchant.id, refA.click.id, "sub_shared");
    await seedReferredSubscription(other.id, refB.click.id, "sub_shared");

    await expect(seedReferredSubscription(merchant.id, refA.click.id, "sub_shared")).rejects.toThrow();
    expect(await db.referredSubscription.count()).toBe(2);
  });

  it("records a subscription once, however often its checkout is redelivered", async () => {
    const { click } = await seedReferral(merchant);
    const first = await recordReferredSubscription(merchant.id, click.id, "sub_1");
    const again = await recordReferredSubscription(merchant.id, click.id, "sub_1");

    expect(again.id).toBe(first.id);
    expect(await db.referredSubscription.count()).toBe(1);
  });

  it("finds a subscription recorded for this product", async () => {
    const { click } = await seedReferral(merchant);
    await seedReferredSubscription(merchant.id, click.id, "sub_1");

    const found = await findReferredSubscription(merchant, "sub_1", "cus_1");

    expect(found?.clickId).toBe(click.id);
    expect(found?.click.affiliate.program.commissionDurationType).toBe("FOREVER");
  });

  it("does not find another product's subscription", async () => {
    const other = await seedMerchant(ownerId);
    const { click } = await seedReferral(other);
    await seedReferredSubscription(other.id, click.id, "sub_1");

    expect(await findReferredSubscription(merchant, "sub_1", "cus_1")).toBeNull();
    expect(stripeStub.invoices.retrieve).not.toHaveBeenCalled();
  });

  it("asks Stripe nothing when no click of this product holds the customer", async () => {
    expect(await findReferredSubscription(merchant, "sub_1", "cus_1")).toBeNull();
    expect(stripeStub.invoices.retrieve).not.toHaveBeenCalled();
  });

  describe("recognising a referral linked before 0.2.5", () => {
    it("adopts the subscription its checkout invoice started, anchored at that invoice's date", async () => {
      const { affiliate, click } = await seedReferral(merchant);
      await seedLegacyClick(click.id, "cus_1");
      const invoiceAt = new Date("2026-01-10T00:00:00Z");
      // The commission row was written minutes later; the anchor is the invoice.
      await seedInvoiceCommission(affiliate.id, click.id, "in_first", new Date("2026-01-10T00:07:00Z"));
      invoicesById([retrievedInvoice("in_first", "sub_1", { created: invoiceAt })]);

      const found = await findReferredSubscription(merchant, "sub_1", "cus_1");

      expect(stripeStub.invoices.retrieve).toHaveBeenCalledWith("in_first");
      expect(found?.clickId).toBe(click.id);
      expect(found?.firstPaymentRef).toBe("in_first");
      expect(found?.firstPaidAt?.toISOString()).toBe(invoiceAt.toISOString());
      expect((await db.click.findUniqueOrThrow({ where: { id: click.id } })).legacyCheckedAt).not.toBeNull();
    });

    it("on a shared Stripe account, refuses another product's subscription whose renewals the click was paid on", async () => {
      // Product A's click holds customer cus_1. Before 0.2.5, product B's
      // renewals on the same account matched that customer and were paid to
      // A's affiliate, so A's click holds commissions on sub_B's renewal
      // invoices. A renewal invoice proves nothing about who was referred.
      const { affiliate, click } = await seedReferral(merchant);
      await seedLegacyClick(click.id, "cus_1");
      await seedInvoiceCommission(affiliate.id, click.id, "in_b2", new Date(Date.now() - 3000));
      await seedInvoiceCommission(affiliate.id, click.id, "in_b3", new Date(Date.now() - 2000));
      invoicesById([
        retrievedInvoice("in_b2", "sub_B", { billingReason: "subscription_cycle" }),
        retrievedInvoice("in_b3", "sub_B", { billingReason: "subscription_cycle" }),
      ]);

      expect(await findReferredSubscription(merchant, "sub_B", "cus_1")).toBeNull();
      expect(await db.referredSubscription.count()).toBe(0);
    });

    it("does not recognise a free trial whose checkout wrote no commission", async () => {
      // Subscriptions created outside a referred checkout never earn, and
      // without a commission nothing proves which subscription the click started.
      const { click } = await seedReferral(merchant);
      await seedLegacyClick(click.id, "cus_1");

      expect(await findReferredSubscription(merchant, "sub_trial", "cus_1")).toBeNull();
      expect(stripeStub.invoices.retrieve).not.toHaveBeenCalled();
      expect(await db.referredSubscription.count()).toBe(0);
      expect((await db.click.findUniqueOrThrow({ where: { id: click.id } })).legacyCheckedAt).not.toBeNull();
    });

    it("asks Stripe only once per click, remembering that nothing matched", async () => {
      const { affiliate, click } = await seedReferral(merchant);
      await seedLegacyClick(click.id, "cus_1");
      await seedInvoiceCommission(affiliate.id, click.id, "in_first");
      invoicesById([retrievedInvoice("in_first", "sub_referred")]);

      expect(await findReferredSubscription(merchant, "sub_other", "cus_1")).toBeNull();
      expect(await findReferredSubscription(merchant, "sub_other", "cus_1")).toBeNull();

      expect(stripeStub.invoices.retrieve).toHaveBeenCalledTimes(1);
      // The subscription the click did start was adopted on that first check.
      expect((await findReferredSubscription(merchant, "sub_referred", "cus_1"))?.clickId).toBe(click.id);
    });

    it("counts an invoice Stripe no longer has as no match", async () => {
      const { affiliate, click } = await seedReferral(merchant);
      await seedLegacyClick(click.id, "cus_1");
      await seedInvoiceCommission(affiliate.id, click.id, "in_gone");
      invoicesById([]);

      await expect(findReferredSubscription(merchant, "sub_1", "cus_1")).resolves.toBeNull();
      expect((await db.click.findUniqueOrThrow({ where: { id: click.id } })).legacyCheckedAt).not.toBeNull();
    });

    it.each(["StripeConnectionError", "StripeRateLimitError", "StripeAPIError"])(
      "throws on %s so the webhook is retried, and records nothing",
      async (type) => {
        const { affiliate, click } = await seedReferral(merchant);
        await seedLegacyClick(click.id, "cus_1");
        await seedInvoiceCommission(affiliate.id, click.id, "in_first");
        stripeStub.invoices.retrieve.mockImplementation(async () => {
          throw stripeError(type);
        });

        await expect(findReferredSubscription(merchant, "sub_1", "cus_1")).rejects.toThrow(type);
        expect((await db.click.findUniqueOrThrow({ where: { id: click.id } })).legacyCheckedAt).toBeNull();
      }
    );

    it.each(["StripePermissionError", "StripeAuthenticationError"])(
      "on %s gives up for now with one warning, without recording the check",
      async (type) => {
        const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { affiliate, click } = await seedReferral(merchant);
        await seedLegacyClick(click.id, "cus_1");
        await seedInvoiceCommission(affiliate.id, click.id, "in_first");
        stripeStub.invoices.retrieve.mockImplementation(async () => {
          throw stripeError(type);
        });
        try {
          await expect(findReferredSubscription(merchant, "sub_1", "cus_1")).resolves.toBeNull();
          expect(warnings).toHaveBeenCalledTimes(1);
          const [message] = warnings.mock.calls[0];
          expect(message).toContain(click.id);
          expect(message).toContain("could not read invoices");
          expect(message).not.toContain("\n");
        } finally {
          warnings.mockRestore();
        }
        expect((await db.click.findUniqueOrThrow({ where: { id: click.id } })).legacyCheckedAt).toBeNull();
      }
    );
  });

  it("keeps the first payment claimed and hands it back to every later payment", async () => {
    const { click } = await seedReferral(merchant);
    const row = await seedReferredSubscription(merchant.id, click.id, "sub_1");
    const first = { ref: "in_a", at: new Date("2026-02-01T00:00:00Z") };

    expect(await claimFirstPayment(row, first)).toEqual(first);
    // The row passed in is stale on purpose: a concurrent handler read it
    // before the first claim landed.
    expect(await claimFirstPayment(row, { ref: "in_b", at: new Date("2026-03-01T00:00:00Z") })).toEqual(first);

    const stored = await db.referredSubscription.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.firstPaymentRef).toBe("in_a");
  });
});
