// Destructive: clears Commission / Click / AffiliateLink / Affiliate / Program /
// Merchant / Owner. Runs against the scratch DATABASE_URL that test/setup.ts
// enforces, never the dev one.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";

import { db } from "@/lib/db";

// Three Stripe calls are reachable: the Customer's exclusion flag, the
// payment behind the invoice, and that payment's charge. The last two default
// to "nothing on record" so only the refund cases see a charge.
const stripeStub = vi.hoisted(() => ({
  customers: {
    retrieve: vi.fn(async () => ({ id: "cus_renewal", metadata: {} })),
    list: vi.fn(async (_params: unknown): Promise<{ data: Array<{ id: string }> }> => ({ data: [] })),
  },
  paymentMethods: {
    list: vi.fn(async (_params: unknown): Promise<unknown> => ({ data: [] })),
  },
  invoicePayments: {
    list: vi.fn(async (): Promise<{ data: unknown[] }> => ({ data: [] })),
  },
  paymentIntents: {
    retrieve: vi.fn(async (): Promise<unknown> => ({ id: "pi_renewal", latest_charge: null })),
  },
  // Only reached when recognising a referral from before 0.2.5; the tests
  // that expect it queue a value.
  invoices: { retrieve: vi.fn(async (_id: string): Promise<unknown> => undefined) },
}));
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe")>("@/lib/stripe");
  return { ...actual, stripeClientFor: () => stripeStub as unknown as Stripe };
});

import { handleInvoicePaid } from "@/lib/worker/handlers/invoicePaid";
import {
  retrievedInvoice,
  seedInvoiceCommission,
  seedLegacyClick,
  seedMerchant,
  seedReferral,
  seedReferredSubscription,
} from "./referralFixtures";

const CUSTOMER_ID = "cus_renewal";
// Renewals are matched on the subscription a referred checkout created, so
// every invoice here belongs to one unless a case says otherwise.
const SUBSCRIPTION_ID = "sub_renewal";

function subscriptionParent(subscription: string) {
  return { type: "subscription_details", subscription_details: { subscription, metadata: {} } };
}

const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

async function clearAll() {
  await db.commission.deleteMany({ where: { adjustsCommissionId: { not: null } } });
  await db.commission.deleteMany();
  await db.referredSubscription.deleteMany();
  await db.click.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

describe("handleInvoicePaid", () => {
  let merchant: Merchant;
  let clickId: string;

  // A 120.00 EUR renewal whose price includes 20.00 VAT, paid in full.
  function invoiceFixture(fields: Record<string, unknown> = {}): Stripe.Invoice {
    return {
      id: "in_renewal",
      customer: CUSTOMER_ID,
      billing_reason: "subscription_cycle",
      created: Math.floor(Date.now() / 1000),
      currency: "eur",
      customer_email: "buyer@example.com",
      metadata: {},
      parent: subscriptionParent(SUBSCRIPTION_ID),
      total: 12000,
      total_excluding_tax: 10000,
      total_taxes: [{ amount: 2000, tax_behavior: "inclusive", taxable_amount: 10000 }],
      amount_paid: 12000,
      shipping_cost: null,
      ...fields,
    } as unknown as Stripe.Invoice;
  }

  beforeEach(async () => {
    await clearAll();
    stripeStub.customers.retrieve.mockClear();
    stripeStub.invoicePayments.list.mockReset();
    stripeStub.invoicePayments.list.mockImplementation(async () => ({ data: [] }));
    stripeStub.paymentIntents.retrieve.mockReset();
    stripeStub.paymentIntents.retrieve.mockImplementation(async () => ({ id: "pi_renewal", latest_charge: null }));
    stripeStub.invoices.retrieve.mockReset();
    stripeStub.customers.list.mockReset();
    stripeStub.customers.list.mockImplementation(async () => ({ data: [] }));
    stripeStub.paymentMethods.list.mockReset();
    stripeStub.paymentMethods.list.mockImplementation(async () => ({ data: [] }));

    const owner = await db.owner.create({
      data: { email: `owner-${crypto.randomUUID()}@example.com`, passwordHash: "x" },
    });
    merchant = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: owner.id,
        name: "InstantGradient",
        domain: `${crypto.randomUUID()}.example.com`,
        websiteUrl: "https://instantgradient.com",
        stripeSecretKeyEnc: "x",
      },
    });
    const program = await db.program.create({
      data: {
        slug: crypto.randomUUID(),
        merchantId: merchant.id,
        name: "Standard",
        defaultCommissionRate: 20,
        commissionDurationType: "FOREVER",
        attributionWindowDays: 60,
        holdingPeriodDays: 30,
      },
    });
    const affiliate = await db.affiliate.create({
      data: {
        merchantId: merchant.id,
        programId: program.id,
        email: `aff-${crypto.randomUUID()}@example.com`,
        links: { create: { code: crypto.randomUUID(), isPrimary: true } },
      },
    });
    const click = await db.click.create({
      data: {
        affiliateId: affiliate.id,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    clickId = click.id;
    // The referred checkout recorded this subscription, and was its first payment.
    await seedReferredSubscription(merchant.id, clickId, SUBSCRIPTION_ID, {
      ref: "in_checkout",
      at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
  });

  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("earns 20.00 on a 120.00 renewal that has 20.00 VAT inside the price", async () => {
    await handleInvoicePaid(merchant, invoiceFixture());

    const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
    expect(commission.saleAmount?.toString()).toBe("100");
    expect(commission.amount.toString()).toBe("20");
    expect(commission.status).toBe("PENDING");
  });

  it("creates nothing on a renewal paid entirely from credit balance", async () => {
    await handleInvoicePaid(merchant, invoiceFixture({ amount_paid: 0 }));
    expect(await db.commission.count()).toBe(0);
  });

  it("earns only on the part credit balance did not cover", async () => {
    // Half the invoice paid in money, half from credit: half the pre-tax base.
    await handleInvoicePaid(merchant, invoiceFixture({ amount_paid: 6000 }));

    const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
    expect(commission.saleAmount?.toString()).toBe("50");
    expect(commission.amount.toString()).toBe("10");
  });

  it("records nothing, and does not fail the event, when the tax cannot be read", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        handleInvoicePaid(merchant, invoiceFixture({ total_excluding_tax: null, total_taxes: null }))
      ).resolves.toBeUndefined();
    } finally {
      errors.mockRestore();
    }
    expect(await db.commission.count()).toBe(0);
  });

  it("applies a refund that happened before the renewal was recorded", async () => {
    stripeStub.invoicePayments.list.mockImplementation(async () => ({
      data: [{ payment: { type: "payment_intent", payment_intent: "pi_renewal" } }],
    }));
    stripeStub.paymentIntents.retrieve.mockImplementation(async () => ({
      id: "pi_renewal",
      latest_charge: { id: "ch_renewal", amount: 12000, amount_refunded: 3000 },
    }));

    await handleInvoicePaid(merchant, invoiceFixture());

    const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
    // A quarter of the charge came back, so a quarter of the 20.00 goes.
    expect(commission.amount.toString()).toBe("15");
    expect(commission.grossAmount?.toString()).toBe("20");
    expect(commission.voidReason).toBe("partial refund");
    expect(stripeStub.invoicePayments.list).toHaveBeenCalledWith({ invoice: "in_renewal", status: "paid", limit: 1 });
  });

  it("creates nothing on a redelivery of the same invoice", async () => {
    await handleInvoicePaid(merchant, invoiceFixture());
    await handleInvoicePaid(merchant, invoiceFixture());
    expect(await db.commission.count()).toBe(1);
  });

  describe("referred subscriptions", () => {
    it("leaves a subscription's first invoice to the checkout that created it", async () => {
      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_create", billing_reason: "subscription_create" }));
      expect(await db.commission.count()).toBe(0);
    });

    it("pays the affiliate of the product the customer subscribed to when products share a Stripe account", async () => {
      const other = await seedMerchant(merchant.ownerId);
      const b = await seedReferral(other);
      await seedReferredSubscription(other.id, b.click.id, "sub_b", { ref: "in_b1", at: new Date() });

      // Both products' webhook endpoints receive a copy of every invoice on
      // the shared account, for the same customer.
      const invoice = invoiceFixture({ id: "in_b2", parent: subscriptionParent("sub_b") });
      await handleInvoicePaid(merchant, invoice);
      await handleInvoicePaid(other, invoice);

      const commissions = await db.commission.findMany({ where: { stripePaymentRef: "in_b2" } });
      expect(commissions.map((c) => c.affiliateId)).toEqual([b.affiliate.id]);
    });

    it("earns nothing on another subscription of a referred customer", async () => {
      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_x", parent: subscriptionParent("sub_unreferred") }));

      expect(await db.commission.count()).toBe(0);
      expect(stripeStub.invoices.retrieve).not.toHaveBeenCalled();
    });

    it("earns nothing on a one-off invoice for a referred customer", async () => {
      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_manual", billing_reason: "manual", parent: null }));
      expect(await db.commission.count()).toBe(0);
    });

    it("reads the subscription from invoices sent in the shape older API versions use", async () => {
      await handleInvoicePaid(merchant, invoiceFixture({ parent: null, subscription: SUBSCRIPTION_ID }));
      expect(await db.commission.count()).toBe(1);
    });

    it("pays a one-time program on the first paid invoice after a free trial, and only on that one", async () => {
      const { click } = await seedReferral(merchant, { durationType: "ONE_TIME" });
      await seedReferredSubscription(merchant.id, click.id, "sub_trial");
      const onTrial = (fields: Record<string, unknown>) =>
        invoiceFixture({ parent: subscriptionParent("sub_trial"), ...fields });

      // The $0 trial invoice neither earns nor uses up the one-time commission.
      await handleInvoicePaid(merchant, onTrial({ id: "in_trial", total: 0, total_excluding_tax: 0, total_taxes: [], amount_paid: 0 }));
      await handleInvoicePaid(merchant, onTrial({ id: "in_first_paid" }));
      // A redelivery of the first paid invoice is still recognised as the first.
      await handleInvoicePaid(merchant, onTrial({ id: "in_first_paid" }));
      await handleInvoicePaid(merchant, onTrial({ id: "in_next" }));

      const refs = (await db.commission.findMany({ where: { clickId: click.id } })).map((c) => c.stripePaymentRef);
      expect(refs).toEqual(["in_first_paid"]);
      const referred = await db.referredSubscription.findFirstOrThrow({ where: { clickId: click.id } });
      expect(referred.firstPaymentRef).toBe("in_first_paid");
    });

    it("pays a one-time program nothing on renewals after its checkout commission", async () => {
      const { click } = await seedReferral(merchant, { durationType: "ONE_TIME" });
      await seedReferredSubscription(merchant.id, click.id, "sub_once", { ref: "in_first", at: new Date() });

      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_2", parent: subscriptionParent("sub_once") }));

      expect(await db.commission.count({ where: { clickId: click.id } })).toBe(0);
    });

    it("counts fixed months from the first payment, not from the click", async () => {
      // Under the old rule a click from a year earlier had already run out.
      const { click } = await seedReferral(merchant, {
        durationType: "FIXED_MONTHS",
        months: 2,
        clickCreatedAt: new Date("2025-01-01T00:00:00Z"),
      });
      await seedReferredSubscription(merchant.id, click.id, "sub_fixed", {
        ref: "in_first",
        at: new Date("2026-01-31T00:00:00Z"),
      });
      const parent = subscriptionParent("sub_fixed");

      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_2", parent, created: seconds("2026-02-28T00:00:00Z") }));
      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_3", parent, created: seconds("2026-03-31T00:00:00Z") }));

      const refs = (await db.commission.findMany({ where: { clickId: click.id } })).map((c) => c.stripePaymentRef);
      expect(refs).toEqual(["in_2"]);
    });

    it("measures a fixed-months window from the earliest payment seen, even delivered out of order", async () => {
      // Stripe does not guarantee delivery order. Month 2 lands first and
      // claims the subscription's first payment; month 1 arrives after it and
      // must move the window back to when the subscription truly started,
      // not stretch it a month further from month 2's later date.
      const { click } = await seedReferral(merchant, { durationType: "FIXED_MONTHS", months: 2 });
      await seedReferredSubscription(merchant.id, click.id, "sub_out_of_order");
      const parent = subscriptionParent("sub_out_of_order");

      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_month_2", parent, created: seconds("2026-02-28T00:00:00Z") }));
      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_month_1", parent, created: seconds("2026-01-31T00:00:00Z") }));
      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_month_3", parent, created: seconds("2026-03-31T00:00:00Z") }));

      const refs = (await db.commission.findMany({ where: { clickId: click.id } })).map((c) => c.stripePaymentRef);
      expect(refs.sort()).toEqual(["in_month_1", "in_month_2"]);
      const referred = await db.referredSubscription.findFirstOrThrow({ where: { clickId: click.id } });
      // The ref stays on whichever payment claimed it first; only the date moves.
      expect(referred.firstPaymentRef).toBe("in_month_2");
      expect(referred.firstPaidAt?.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    });

    it("pays a one-time program only once when its first payment is delivered out of order", async () => {
      const { click } = await seedReferral(merchant, { durationType: "ONE_TIME" });
      await seedReferredSubscription(merchant.id, click.id, "sub_once_out_of_order");
      const parent = subscriptionParent("sub_once_out_of_order");

      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_month_2", parent, created: seconds("2026-02-28T00:00:00Z") }));
      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_month_1", parent, created: seconds("2026-01-31T00:00:00Z") }));

      expect(await db.commission.count({ where: { clickId: click.id } })).toBe(1);
    });

    it("creates nothing once a self referral was confirmed on the click", async () => {
      await db.click.update({ where: { id: clickId }, data: { fraudConfirmedAt: new Date() } });

      await handleInvoicePaid(merchant, invoiceFixture());

      expect(await db.commission.count()).toBe(0);
    });

    it("flags a renewal billed to the affiliate's own email", async () => {
      const { click } = await seedReferral(merchant, { affiliateEmail: "own@example.com" });
      await seedReferredSubscription(merchant.id, click.id, "sub_own", { ref: "in_first", at: new Date() });

      await handleInvoicePaid(
        merchant,
        invoiceFixture({ id: "in_own", parent: subscriptionParent("sub_own"), customer_email: "OWN@example.com" })
      );

      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.status).toBe("FLAGGED");
      expect(commission.flagReason).toMatch(/^email:/);
    });

    it("keeps paying a subscription referred before this release, recognised by its checkout invoice", async () => {
      const { affiliate, click } = await seedReferral(merchant);
      await seedLegacyClick(click.id, "cus_legacy");
      await seedInvoiceCommission(affiliate.id, click.id, "in_legacy_first");
      stripeStub.invoices.retrieve.mockResolvedValueOnce(retrievedInvoice("in_legacy_first", "sub_legacy"));

      await handleInvoicePaid(
        merchant,
        invoiceFixture({ id: "in_legacy_2", customer: "cus_legacy", parent: subscriptionParent("sub_legacy") })
      );

      expect(stripeStub.invoices.retrieve).toHaveBeenCalledWith("in_legacy_first");
      expect(await db.commission.count({ where: { stripePaymentRef: "in_legacy_2" } })).toBe(1);
    });

    it("does not pay a legacy customer's subscription that their referral did not start", async () => {
      const { affiliate, click } = await seedReferral(merchant);
      await seedLegacyClick(click.id, "cus_legacy");
      await seedInvoiceCommission(affiliate.id, click.id, "in_legacy_first");
      stripeStub.invoices.retrieve.mockResolvedValueOnce(retrievedInvoice("in_legacy_first", "sub_referred"));

      await handleInvoicePaid(
        merchant,
        invoiceFixture({ id: "in_other", customer: "cus_legacy", parent: subscriptionParent("sub_unreferred") })
      );

      expect(await db.commission.count({ where: { stripePaymentRef: "in_other" } })).toBe(0);
    });
  });

  describe("card check on renewals", () => {
    // The renewal was paid by pi_card, whose card is also saved on one of the
    // affiliate's own Stripe customers.
    function payWithAffiliatesCard() {
      stripeStub.invoicePayments.list.mockImplementation(async () => ({
        data: [{ payment: { type: "payment_intent", payment_intent: "pi_card" } }],
      }));
      stripeStub.paymentIntents.retrieve.mockImplementation(async () => ({
        id: "pi_card",
        latest_charge: null,
        payment_method: { id: "pm_card", card: { fingerprint: "fp_own" } },
      }));
      stripeStub.customers.list.mockImplementation(async () => ({ data: [{ id: "cus_affiliate_own" }] }));
      stripeStub.paymentMethods.list.mockImplementation(async () => ({ data: [{ card: { fingerprint: "fp_own" } }] }));
    }

    it("flags every renewal paid with a card that matches one of the affiliate's own customers", async () => {
      payWithAffiliatesCard();

      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_r1" }));
      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_r2" }));

      const commissions = await db.commission.findMany({ where: { clickId }, orderBy: { stripePaymentRef: "asc" } });
      expect(commissions.map((c) => [c.stripePaymentRef, c.status, c.flagReason])).toEqual([
        ["in_r1", "FLAGGED", "card"],
        ["in_r2", "FLAGGED", "card"],
      ]);
      expect(stripeStub.paymentIntents.retrieve).toHaveBeenCalledWith("pi_card", { expand: ["payment_method"] });
    });

    it("flags the first paid invoice after a free trial the same way", async () => {
      const { click } = await seedReferral(merchant);
      await seedReferredSubscription(merchant.id, click.id, "sub_trial_card");
      payWithAffiliatesCard();

      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_trial_paid", parent: subscriptionParent("sub_trial_card") }));

      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.flagReason).toBe("card");
    });

    it("still records the renewal, unflagged, when Stripe fails during the check", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      payWithAffiliatesCard();
      stripeStub.customers.list.mockImplementation(async () => {
        throw new Error("rate limited");
      });
      try {
        await handleInvoicePaid(merchant, invoiceFixture());
      } finally {
        errors.mockRestore();
      }

      const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
      expect(commission.status).toBe("PENDING");
      expect(commission.flagReason).toBeNull();
    });
  });
});
