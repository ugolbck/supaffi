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
  disputes: {
    list: vi.fn(async (_params: unknown): Promise<{ data: unknown[] }> => ({ data: [] })),
  },
  paymentIntents: {
    retrieve: vi.fn(async (): Promise<unknown> => ({ id: "pi_renewal", latest_charge: null })),
  },
  invoices: {
    // Only reached when recognising a referral from before 0.2.5; the tests
    // that expect it queue a value.
    retrieve: vi.fn(async (_id: string): Promise<unknown> => undefined),
    // Every renewal that can earn reads its lines. beforeEach answers from the
    // lines invoiceFixture registered for that invoice.
    listLineItems: vi.fn(async (_id: string, _params?: unknown): Promise<unknown> => undefined),
  },
  // Read when a legacy referral is recognised, for the products it bills.
  subscriptions: {
    retrieve: vi.fn(async (id: string): Promise<unknown> => ({
      id,
      items: { data: [{ id: "si_basic", price: { product: "prod_basic" } }], has_more: false },
    })),
  },
}));
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe")>("@/lib/stripe");
  return { ...actual, stripeClientFor: () => stripeStub as unknown as Stripe };
});

import { handleInvoicePaid } from "@/lib/worker/handlers/invoicePaid";
import { confirmCommissionFraud } from "@/lib/commission";
import {
  retrievedInvoice,
  seedInvoiceCommission,
  seedLegacyClick,
  seedMerchant,
  seedReferral,
  seedReferredSubscription,
} from "./referralFixtures";
import { invoiceLine, PRODUCT_ID } from "./invoiceLines";
import { subscriptionIdOf } from "@/lib/worker/referredSubscription";

const CUSTOMER_ID = "cus_renewal";
// Renewals are matched on the subscription a referred checkout created, so
// every invoice here belongs to one unless a case says otherwise.
const SUBSCRIPTION_ID = "sub_renewal";

// The lines Stripe lists for each invoice id, registered by invoiceFixture.
const linesByInvoice = new Map<string, Stripe.InvoiceLineItem[]>();

// What `stripe.invoices.retrieve(id, { expand: ["amount_paid_off_stripe"] })`
// answers for each invoice id, registered by invoiceFixture. The webhook
// payload itself never carries amount_paid_off_stripe (it is an expandable
// field, see the handler's comment), so this is the only place a case can set
// it; a case that wants the field to come back absent overrides
// stripeStub.invoices.retrieve directly instead of using this map.
const invoiceReadsById = new Map<string, { total: number; amount_paid: number; amount_paid_off_stripe: number }>();

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

  // A 120.00 EUR renewal whose price includes 20.00 VAT, paid in full. Its
  // lines default to the one subscription line that makes up that total.
  // `amount_paid_off_stripe` never goes on the payload itself (it is an
  // expandable field Stripe never sends on a webhook object); passing it in
  // `fields` only feeds the registered retrieve stub's answer.
  function invoiceFixture(
    fields: Record<string, unknown> & { amount_paid_off_stripe?: number } = {},
    lines?: Stripe.InvoiceLineItem[]
  ): Stripe.Invoice {
    const { amount_paid_off_stripe, ...payloadFields } = fields;
    const invoice = {
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
      ...payloadFields,
    } as unknown as Stripe.Invoice;
    linesByInvoice.set(
      invoice.id,
      lines ?? [
        invoiceLine({
          amount: invoice.total,
          inclusiveTax: invoice.total - (invoice.total_excluding_tax ?? invoice.total),
          subscription: subscriptionIdOf(invoice),
        }),
      ]
    );
    invoiceReadsById.set(invoice.id, {
      total: invoice.total,
      amount_paid: invoice.amount_paid,
      amount_paid_off_stripe: amount_paid_off_stripe ?? 0,
    });
    return invoice;
  }

  beforeEach(async () => {
    await clearAll();
    stripeStub.customers.retrieve.mockClear();
    stripeStub.invoicePayments.list.mockReset();
    stripeStub.invoicePayments.list.mockImplementation(async () => ({ data: [] }));
    stripeStub.paymentIntents.retrieve.mockReset();
    stripeStub.paymentIntents.retrieve.mockImplementation(async () => ({ id: "pi_renewal", latest_charge: null }));
    stripeStub.disputes.list.mockReset();
    stripeStub.disputes.list.mockImplementation(async () => ({ data: [] }));
    stripeStub.invoices.retrieve.mockReset();
    invoiceReadsById.clear();
    // Answers the out-of-band read for whichever invoice invoiceFixture
    // registered. Legacy-recognition tests queue their own answer ahead of
    // this with mockResolvedValueOnce, which this default never overrides.
    stripeStub.invoices.retrieve.mockImplementation(async (id: string) => {
      const read = invoiceReadsById.get(id);
      return read ? { id, ...read } : undefined;
    });
    linesByInvoice.clear();
    stripeStub.invoices.listLineItems.mockReset();
    stripeStub.invoices.listLineItems.mockImplementation(async (id: string) => ({
      data: linesByInvoice.get(id) ?? [],
      has_more: false,
    }));
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
    await seedReferredSubscription(
      merchant.id,
      clickId,
      SUBSCRIPTION_ID,
      { ref: "in_checkout", at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      [PRODUCT_ID]
    );
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

  it("holds a renewal whose charge is already under an open dispute", async () => {
    stripeStub.invoicePayments.list.mockImplementation(async () => ({
      data: [{ payment: { type: "payment_intent", payment_intent: "pi_renewal" } }],
    }));
    stripeStub.paymentIntents.retrieve.mockImplementation(async () => ({
      id: "pi_renewal",
      latest_charge: { id: "ch_renewal", amount: 12000, amount_refunded: 0, disputed: true },
    }));
    stripeStub.disputes.list.mockImplementation(async () => ({ data: [{ id: "dp_1", status: "under_review" }] }));

    await handleInvoicePaid(merchant, invoiceFixture());

    const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
    expect(commission.status).toBe("PENDING");
    expect(commission.disputeOpenedAt).not.toBeNull();
    expect(stripeStub.disputes.list).toHaveBeenCalledWith({ payment_intent: "pi_renewal", limit: 100 });
  });

  it("holds a renewal, and logs, when its disputed charge's dispute list is still empty", async () => {
    // A disputed charge always has at least one dispute, so an empty list is
    // the opening event having arrived and been dropped before this row
    // existed, not a charge cleared of every dispute.
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    stripeStub.invoicePayments.list.mockImplementation(async () => ({
      data: [{ payment: { type: "payment_intent", payment_intent: "pi_renewal" } }],
    }));
    stripeStub.paymentIntents.retrieve.mockImplementation(async () => ({
      id: "pi_renewal",
      latest_charge: { id: "ch_renewal", amount: 12000, amount_refunded: 0, disputed: true },
    }));

    try {
      await handleInvoicePaid(merchant, invoiceFixture());
      const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
      expect(warnings).toHaveBeenCalledTimes(1);
      expect(warnings).toHaveBeenCalledWith(expect.stringContaining(commission.id));
    } finally {
      warnings.mockRestore();
    }

    const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
    expect(commission.status).toBe("PENDING");
    expect(commission.disputeOpenedAt).not.toBeNull();
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

    it("earns nothing on the next renewal once the Owner confirmed a self referral from an unflagged commission", async () => {
      const { affiliateId } = await db.click.findUniqueOrThrow({ where: { id: clickId } });
      const first = await db.commission.create({
        data: {
          affiliateId,
          clickId,
          stripePaymentRef: "in_checkout",
          amount: "20.00",
          grossAmount: "20.00",
          currency: "eur",
          status: "PENDING",
          payableAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      await confirmCommissionFraud(merchant.ownerId, merchant.id, first.id);
      await handleInvoicePaid(merchant, invoiceFixture());

      expect(await db.commission.count({ where: { stripePaymentRef: "in_renewal" } })).toBe(0);
      expect((await db.commission.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("VOIDED");
    });

    it("creates nothing when the self referral is confirmed while the renewal is being processed", async () => {
      // Confirmed after the handler's first check on the click, during its
      // Stripe reads, and before it writes.
      stripeStub.invoicePayments.list.mockImplementationOnce(async () => {
        await db.click.update({ where: { id: clickId }, data: { fraudConfirmedAt: new Date() } });
        return { data: [] };
      });

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

    it("does not recognise a legacy referral whose first purchase never earned, such as a trial that converted", async () => {
      // Before 0.2.5 only invoices that actually earned a commission left a
      // trace on the click, so a trial's subscription_create invoice, which
      // charged nothing, left none. What is on the click is the renewal
      // commissions the old code recorded straight from invoice.paid, and
      // none of those is billing_reason subscription_create, so nothing here
      // is adopted and the subscription stays unrecognised.
      const { affiliate, click } = await seedReferral(merchant);
      await seedLegacyClick(click.id, "cus_legacy");
      await seedInvoiceCommission(affiliate.id, click.id, "in_legacy_renewal_1");
      await seedInvoiceCommission(affiliate.id, click.id, "in_legacy_renewal_2");
      stripeStub.invoices.retrieve.mockImplementation(async (id: string) =>
        retrievedInvoice(id, "sub_trial", { billingReason: "subscription_cycle" })
      );

      await handleInvoicePaid(
        merchant,
        invoiceFixture({ id: "in_after_upgrade", customer: "cus_legacy", parent: subscriptionParent("sub_trial") })
      );

      expect(await db.commission.count({ where: { stripePaymentRef: "in_after_upgrade" } })).toBe(0);
      expect(await db.referredSubscription.count({ where: { stripeSubscriptionId: "sub_trial" } })).toBe(0);
    });
  });

  describe("only referred subscription revenue earns", () => {
    it.each(["manual", "quote_accept", "automatic_pending_invoice_item_invoice", "subscription_threshold", "upcoming", "subscription", null])(
      "earns nothing on an invoice billed for %s, even on the referred subscription",
      async (billingReason) => {
        await handleInvoicePaid(merchant, invoiceFixture({ id: "in_other_reason", billing_reason: billingReason }));

        expect(await db.commission.count()).toBe(0);
        expect(stripeStub.invoices.listLineItems).not.toHaveBeenCalled();
      }
    );

    it("does not let a manual invoice on a free trial use up a one-time program's first payment", async () => {
      const { click } = await seedReferral(merchant, { durationType: "ONE_TIME" });
      await seedReferredSubscription(merchant.id, click.id, "sub_trial_manual", undefined, [PRODUCT_ID]);
      const parent = subscriptionParent("sub_trial_manual");

      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_manual_fee", billing_reason: "manual", parent }));
      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_first_cycle", parent }));

      const refs = (await db.commission.findMany({ where: { clickId: click.id } })).map((c) => c.stripePaymentRef);
      expect(refs).toEqual(["in_first_cycle"]);
    });

    it("earns only on the subscription's line when a customer's one-off item is swept into the renewal", async () => {
      // The 120.00 renewal with 20.00 VAT inside, plus a 60.00 setup fee with
      // 10.00 VAT inside that the merchant added to the customer.
      const invoice = invoiceFixture(
        {
          total: 18000,
          total_excluding_tax: 15000,
          total_taxes: [{ amount: 3000, tax_behavior: "inclusive", taxable_amount: 15000 }],
          amount_paid: 18000,
        },
        [invoiceLine({ amount: 12000, inclusiveTax: 2000 }), invoiceLine({ amount: 6000, inclusiveTax: 1000, source: "invoice_item" })]
      );

      await handleInvoicePaid(merchant, invoice);

      const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
      expect(commission.saleAmount?.toString()).toBe("100");
      expect(commission.amount.toString()).toBe("20");
    });

    it("earns on a discounted renewal with VAT inside the price, before tax and after the discount", async () => {
      // 120.00 with 20% VAT inside, 20% off: 96.00 paid, 16.00 of it VAT.
      const invoice = invoiceFixture(
        {
          total: 9600,
          total_excluding_tax: 8000,
          total_taxes: [{ amount: 1600, tax_behavior: "inclusive", taxable_amount: 8000 }],
          amount_paid: 9600,
        },
        [invoiceLine({ amount: 12000, discount: 2400, inclusiveTax: 1600 })]
      );

      await handleInvoicePaid(merchant, invoice);

      const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
      expect(commission.saleAmount?.toString()).toBe("80");
      expect(commission.amount.toString()).toBe("16");
    });

    it("earns on a plan change inside the same product, prorations included", async () => {
      // From 100.00 to 160.00 a month halfway through, no tax: 50.00 back for
      // the old price's unused half, 80.00 for the new price's.
      const invoice = invoiceFixture(
        { id: "in_upgrade", billing_reason: "subscription_update", total: 3000, total_excluding_tax: 3000, total_taxes: [], amount_paid: 3000 },
        [invoiceLine({ amount: -5000, proration: true }), invoiceLine({ amount: 8000, proration: true })]
      );

      await handleInvoicePaid(merchant, invoice);

      const commission = await db.commission.findFirstOrThrow({ where: { stripePaymentRef: "in_upgrade" } });
      expect(commission.saleAmount?.toString()).toBe("30");
      expect(commission.amount.toString()).toBe("6");
    });

    it("earns nothing, and logs once, after the subscription moved to another product", async () => {
      const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await handleInvoicePaid(
          merchant,
          invoiceFixture({ id: "in_switched" }, [invoiceLine({ amount: 12000, inclusiveTax: 2000, product: "prod_other" })])
        );
        expect(warnings).toHaveBeenCalledTimes(1);
        const [message] = warnings.mock.calls[0];
        expect(message).toContain("in_switched");
        expect(message).toContain("prod_other");
        expect(message).not.toContain("\n");
      } finally {
        warnings.mockRestore();
      }
      expect(await db.commission.count()).toBe(0);
    });

    it("takes the products of a subscription recorded before 0.2.7 from its next renewal, then holds it to them", async () => {
      const { click } = await seedReferral(merchant);
      await seedReferredSubscription(merchant.id, click.id, "sub_no_products", { ref: "in_first", at: new Date() });
      const parent = subscriptionParent("sub_no_products");

      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_fills", parent }));
      const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await handleInvoicePaid(
          merchant,
          invoiceFixture({ id: "in_after_switch", parent }, [
            invoiceLine({ amount: 12000, inclusiveTax: 2000, subscription: "sub_no_products", product: "prod_other" }),
          ])
        );
      } finally {
        warnings.mockRestore();
      }

      const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_no_products" } });
      expect(referred.stripeProductIds).toEqual([PRODUCT_ID]);
      const refs = (await db.commission.findMany({ where: { clickId: click.id } })).map((c) => c.stripePaymentRef);
      expect(refs).toEqual(["in_fills"]);
    });

    it("reads every page of a renewal's lines before earning", async () => {
      stripeStub.invoices.listLineItems.mockImplementation(async (_id: string, params?: unknown) =>
        (params as { starting_after?: string } | undefined)?.starting_after === "il_page_1"
          ? { data: [invoiceLine({ id: "il_page_2", amount: 6000, inclusiveTax: 1000 })], has_more: false }
          : { data: [invoiceLine({ id: "il_page_1", amount: 6000, inclusiveTax: 1000 })], has_more: true }
      );

      await handleInvoicePaid(merchant, invoiceFixture());

      const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
      expect(commission.saleAmount?.toString()).toBe("100");
      expect(stripeStub.invoices.listLineItems).toHaveBeenCalledWith("in_renewal", { limit: 100, starting_after: "il_page_1" });
    });

    it("earns nothing, and logs once, when a line's origin cannot be read", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await handleInvoicePaid(
          merchant,
          invoiceFixture({ id: "in_unknown" }, [invoiceLine({ amount: 12000, inclusiveTax: 2000, source: "unknown" })])
        );
        expect(errors).toHaveBeenCalledTimes(1);
        const [message] = errors.mock.calls[0];
        expect(message).toContain("in_unknown");
        expect(message).not.toContain("\n");
      } finally {
        errors.mockRestore();
      }
      expect(await db.commission.count()).toBe(0);
    });

    it("throws so the event is retried when Stripe cannot list the lines", async () => {
      const failure = new Error("StripeConnectionError");
      stripeStub.invoices.listLineItems.mockImplementation(async () => {
        throw failure;
      });

      await expect(handleInvoicePaid(merchant, invoiceFixture())).rejects.toBe(failure);
      expect(await db.commission.count()).toBe(0);
    });
  });

  describe("out-of-band payments", () => {
    it("earns nothing, and logs once, on a renewal paid entirely outside Stripe", async () => {
      const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await handleInvoicePaid(merchant, invoiceFixture({ amount_paid_off_stripe: 12000 }));
        expect(warnings).toHaveBeenCalledTimes(1);
        const [message] = warnings.mock.calls[0];
        expect(message).toContain("in_renewal");
        expect(message).not.toContain("buyer@example.com");
        expect(message).not.toContain("cus_renewal");
      } finally {
        warnings.mockRestore();
      }
      expect(await db.commission.count()).toBe(0);
    });

    it("earns only on the part paid through Stripe when a renewal is paid partly out of band", async () => {
      // 120.00 with 20.00 VAT inside; 60.00 of the 120.00 paid was settled
      // outside Stripe, so only the other half is scaled into the base.
      await handleInvoicePaid(merchant, invoiceFixture({ amount_paid_off_stripe: 6000 }));

      const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
      expect(commission.saleAmount?.toString()).toBe("50");
      expect(commission.amount.toString()).toBe("10");
    });

    it("earns the same as before amount_paid_off_stripe existed, when a renewal carries none of it", async () => {
      await handleInvoicePaid(merchant, invoiceFixture());

      const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
      expect(commission.saleAmount?.toString()).toBe("100");
      expect(commission.amount.toString()).toBe("20");
    });

    it("throws so the event is retried when Stripe cannot answer the out-of-band read", async () => {
      const invoice = invoiceFixture();
      const failure = new Error("StripeConnectionError");
      stripeStub.invoices.retrieve.mockImplementation(async () => {
        throw failure;
      });

      await expect(handleInvoicePaid(merchant, invoice)).rejects.toBe(failure);
      expect(await db.commission.count()).toBe(0);
    });

    it("earns nothing, and logs once, when Stripe answers the retrieve without amount_paid_off_stripe even though it was expanded", async () => {
      const invoice = invoiceFixture();
      // Answers the read without the field at all, as this pinned version is
      // not documented to ever do, rather than a queued 0 or the payload's own
      // (also absent) value.
      stripeStub.invoices.retrieve.mockImplementation(async (id: string) => ({ id, total: 12000, amount_paid: 12000 }));
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await handleInvoicePaid(merchant, invoice);
        expect(errors).toHaveBeenCalledTimes(1);
        const [message] = errors.mock.calls[0];
        expect(message).toContain("in_renewal");
        expect(message).toContain("amount_paid_off_stripe");
      } finally {
        errors.mockRestore();
      }
      expect(await db.commission.count()).toBe(0);
      expect(stripeStub.invoices.listLineItems).not.toHaveBeenCalled();
    });
  });

  describe("referredChargeMinor", () => {
    // Registers a real charge for the invoice, the way "applies a refund"
    // above does, so the cap against charge.amount has something to compare.
    function chargePaid(amount: number) {
      stripeStub.invoicePayments.list.mockImplementation(async () => ({
        data: [{ payment: { type: "payment_intent", payment_intent: "pi_renewal" } }],
      }));
      stripeStub.paymentIntents.retrieve.mockImplementation(async () => ({
        id: "pi_renewal",
        latest_charge: { id: "ch_renewal", amount, amount_refunded: 0 },
      }));
    }

    it("equals the charge amount on a simple, fully referred renewal", async () => {
      chargePaid(12000);
      await handleInvoicePaid(merchant, invoiceFixture());

      const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
      expect(commission.referredChargeMinor).toBe(12000);
    });

    it("never stores more than the charge itself, even when the computed share is larger", async () => {
      // The invoice's own total (12000) computes a larger share than the
      // charge actually moved (10000, as if a rounding or shipping
      // difference separated the two); the cap must hold.
      chargePaid(10000);
      await handleInvoicePaid(merchant, invoiceFixture());

      const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
      expect(commission.referredChargeMinor).toBe(10000);
    });

    it("reads the share from each line's own tax, not spread evenly over an untaxed referred line next to a taxed add-on", async () => {
      // 100.00 referred plan with no tax, 100.00 add-on with 20.00 of
      // exclusive tax on top: 220.00 charged. Spreading the 20.00 evenly
      // across both lines would store 110.00; only the referred line's own
      // (untaxed) share, 100.00, is correct.
      const invoice = invoiceFixture(
        {
          total: 22000,
          total_excluding_tax: 20000,
          total_taxes: [{ amount: 2000, tax_behavior: "exclusive", taxable_amount: 10000 }],
          amount_paid: 22000,
        },
        [invoiceLine({ amount: 10000 }), invoiceLine({ amount: 10000, exclusiveTax: 2000, product: "prod_addon" })]
      );

      await handleInvoicePaid(merchant, invoice);

      const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
      expect(commission.referredChargeMinor).toBe(10000);
    });

    it("rounds a fractional exact share down, never up", async () => {
      // 100 minor units referred, 100 of another product, both untaxed, 200
      // total; only 101 was actually paid in money. The referred share of
      // what was paid is exactly 50.5, which must round down to 50, not up
      // to 51.
      const invoice = invoiceFixture(
        { total: 200, total_excluding_tax: 200, total_taxes: [], amount_paid: 101 },
        [invoiceLine({ amount: 100 }), invoiceLine({ amount: 100, product: "prod_other" })]
      );

      await handleInvoicePaid(merchant, invoice);

      const commission = await db.commission.findFirstOrThrow({ where: { clickId } });
      expect(commission.referredChargeMinor).toBe(50);
    });
  });

  describe("one duration per referral", () => {
    async function refsOn(clickId: string) {
      const rows = await db.commission.findMany({ where: { clickId } });
      return rows.map((c) => c.stripePaymentRef).sort();
    }

    it("measures a second subscription on the same click from the click's first payment", async () => {
      const { click } = await seedReferral(merchant, { durationType: "FIXED_MONTHS", months: 3 });
      await seedReferredSubscription(merchant.id, click.id, "sub_first", { ref: "in_first", at: new Date("2026-01-31T00:00:00Z") });
      await seedReferredSubscription(merchant.id, click.id, "sub_second", { ref: "in_second", at: new Date("2026-03-15T00:00:00Z") });
      const parent = subscriptionParent("sub_second");

      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_second_2", parent, created: seconds("2026-04-15T00:00:00Z") }));
      // Inside sub_second's own three months, but past the referral's, which
      // started on January 31 and ended on April 30.
      await handleInvoicePaid(merchant, invoiceFixture({ id: "in_second_3", parent, created: seconds("2026-05-15T00:00:00Z") }));

      expect(await refsOn(click.id)).toEqual(["in_second_2"]);
    });

    it("pays a one-time program nothing on a second subscription once the first spent the referral's payment", async () => {
      // The first subscription's checkout was excluded, so it left no
      // commission, but money moved and the referral's one payment is used.
      const { click } = await seedReferral(merchant, { durationType: "ONE_TIME" });
      await seedReferredSubscription(merchant.id, click.id, "sub_first", { ref: "in_first", at: new Date("2026-01-10T00:00:00Z") });
      await seedReferredSubscription(merchant.id, click.id, "sub_trial");

      await handleInvoicePaid(
        merchant,
        invoiceFixture({ id: "in_trial_paid", parent: subscriptionParent("sub_trial"), created: seconds("2026-02-10T00:00:00Z") })
      );

      expect(await db.commission.count({ where: { clickId: click.id } })).toBe(0);
      const trial = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_trial" } });
      expect(trial.firstPaymentRef).toBe("in_trial_paid");
    });

    it("pays a one-time program once when a later subscription's first payment is processed before an earlier one's", async () => {
      const { click } = await seedReferral(merchant, { durationType: "ONE_TIME" });
      await seedReferredSubscription(merchant.id, click.id, "sub_early");
      await seedReferredSubscription(merchant.id, click.id, "sub_late");

      await handleInvoicePaid(
        merchant,
        invoiceFixture({ id: "in_late_1", parent: subscriptionParent("sub_late"), created: seconds("2026-02-20T00:00:00Z") })
      );
      await handleInvoicePaid(
        merchant,
        invoiceFixture({ id: "in_early_1", parent: subscriptionParent("sub_early"), created: seconds("2026-02-10T00:00:00Z") })
      );

      expect(await refsOn(click.id)).toEqual(["in_late_1"]);
    });

    it("moves a fixed-months window back when an earlier subscription's first payment is processed late, keeping an already-earned payment now outside it", async () => {
      const { click } = await seedReferral(merchant, { durationType: "FIXED_MONTHS", months: 2 });
      await seedReferredSubscription(merchant.id, click.id, "sub_early");
      await seedReferredSubscription(merchant.id, click.id, "sub_late");

      // Processed first, it was the referral's start when it was judged, even
      // though the window that later replaces it, once in_early_1 arrives,
      // ends on March 31, before this payment's own date of April 2.
      await handleInvoicePaid(
        merchant,
        invoiceFixture({ id: "in_late_1", parent: subscriptionParent("sub_late"), created: seconds("2026-04-02T00:00:00Z") })
      );
      await handleInvoicePaid(
        merchant,
        invoiceFixture({ id: "in_early_1", parent: subscriptionParent("sub_early"), created: seconds("2026-01-31T00:00:00Z") })
      );
      // Inside sub_late's own two months, past the referral's, which ended on March 31.
      await handleInvoicePaid(
        merchant,
        invoiceFixture({ id: "in_late_2", parent: subscriptionParent("sub_late"), created: seconds("2026-05-05T00:00:00Z") })
      );

      expect(await refsOn(click.id)).toEqual(["in_early_1", "in_late_1"]);
    });

    it("measures a referral recognised from before 0.2.5 from its checkout invoice", async () => {
      const { affiliate, click } = await seedReferral(merchant, { durationType: "FIXED_MONTHS", months: 3 });
      await seedLegacyClick(click.id, "cus_legacy");
      await seedInvoiceCommission(affiliate.id, click.id, "in_legacy_first", new Date("2026-01-10T00:00:00Z"));
      stripeStub.invoices.retrieve.mockResolvedValueOnce(
        retrievedInvoice("in_legacy_first", "sub_legacy", { created: new Date("2026-01-10T00:00:00Z") })
      );
      const legacy = (id: string, iso: string) =>
        invoiceFixture({ id, customer: "cus_legacy", parent: subscriptionParent("sub_legacy"), created: seconds(iso) });

      await handleInvoicePaid(merchant, legacy("in_legacy_2", "2026-02-10T00:00:00Z"));
      await handleInvoicePaid(merchant, legacy("in_legacy_5", "2026-05-10T00:00:00Z"));

      expect(await refsOn(click.id)).toEqual(["in_legacy_2", "in_legacy_first"]);
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
