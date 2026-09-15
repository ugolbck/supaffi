// Destructive: clears Commission / Click / AffiliateLink / Affiliate / Program /
// Merchant / Owner. Runs against the scratch DATABASE_URL that test/setup.ts
// enforces, never the dev one.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";

import { db } from "@/lib/db";

// The handler resolves a Stripe client for the Merchant and, once a sale would
// earn, reads its invoice back with its subscription and customer expanded to
// check the exclusion flag. Nothing here touches the network; the stub
// answers every call the handler can reach. The rest of the module
// (minorUnitsToMajor, used by the commission maths) stays real. The handler
// also looks up the charge behind the payment, to fold in a refund made
// before the commission existed. By default the invoice has no payment on
// record, so that lookup finds nothing and changes nothing.
const stripeStub = vi.hoisted(() => ({
  customers: {
    retrieve: vi.fn(async () => ({ id: "cus_test", metadata: {} })),
  },
  // The subscription a checkout created is read once for the products it bills.
  subscriptions: {
    retrieve: vi.fn(async (_id: string): Promise<unknown> => undefined),
  },
  subscriptionItems: {
    list: vi.fn(async (_params: unknown): Promise<unknown> => undefined),
  },
  invoicePayments: {
    list: vi.fn(async (): Promise<{ data: unknown[] }> => ({ data: [] })),
  },
  paymentIntents: {
    retrieve: vi.fn(async (): Promise<unknown> => ({ id: "pi_test", latest_charge: null })),
  },
  disputes: {
    list: vi.fn(async (_params: unknown): Promise<{ data: unknown[] }> => ({ data: [] })),
  },
  // A one-time purchase's Session, read back with its tax breakdown, customer
  // and invoice expanded.
  checkout: {
    sessions: {
      retrieve: vi.fn(async (_id: string, _params?: unknown): Promise<unknown> => undefined),
    },
  },
  // Read for the exclusion flag on a Session's invoice, with its subscription
  // and customer expanded.
  invoices: {
    retrieve: vi.fn(async (id: string, _params?: unknown): Promise<unknown> => ({ id, metadata: {} })),
    // A subscription's first invoice earns on its lines, like a renewal.
    listLineItems: vi.fn(async (_id: string, _params?: unknown): Promise<unknown> => undefined),
  },
}));
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe")>("@/lib/stripe");
  return { ...actual, stripeClientFor: () => stripeStub as unknown as Stripe };
});

// The two self-referral vectors that cost Stripe API calls. The email vector
// stays real: it reads the payload inline and costs nothing.
vi.mock("@/lib/worker/selfReferral", async () => {
  const actual = await vi.importActual<typeof import("@/lib/worker/selfReferral")>(
    "@/lib/worker/selfReferral"
  );
  return {
    ...actual,
    resolveBuyerFingerprint: vi.fn(async () => null),
    checkPaymentMethodOverlap: vi.fn(async () => null),
  };
});

import { handleCheckoutSessionCompleted } from "@/lib/worker/handlers/checkoutSessionCompleted";
import { REFERRAL_METADATA_KEY } from "@/lib/referral";
import { handleInvoicePaid } from "@/lib/worker/handlers/invoicePaid";
import { handleSubscriptionDeleted } from "@/lib/worker/handlers/subscriptionDeleted";
import { EARNING_INVOICE_EXPAND } from "@/lib/worker/referredRevenue";
import { invoiceLine } from "./invoiceLines";

const CUSTOMER_ID = "cus_test";

async function clearAll() {
  await db.commission.deleteMany();
  await db.referredSubscription.deleteMany();
  await db.click.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

describe("handleCheckoutSessionCompleted", () => {
  let merchant: Merchant;
  let click: { id: string };
  let clickInput: { affiliateId: string; referralToken: string; expiresAt: Date };
  // What Stripe answers when the handler reads a Session's invoice back with
  // its subscription and customer expanded, registered by sessionFixture.
  const invoiceReadsById = new Map<string, Record<string, unknown>>();
  // The lines Stripe lists for each invoice, registered by sessionFixture.
  const linesByInvoice = new Map<string, Stripe.InvoiceLineItem[]>();
  // What Stripe answers when the handler reads a Session back, registered by sessionFixture.
  const sessionsById = new Map<string, Record<string, unknown>>();

  function sessionFixture(opts: {
    invoice?: string | null;
    metadataToken?: string;
    paymentStatus?: Stripe.Checkout.Session.PaymentStatus;
    amountTotal?: number;
    tax?: number;
    totalDetails?: null;
    shippingCost?: { amount_subtotal: number; amount_tax: number; amount_total: number };
    currency?: string;
    mode?: Stripe.Checkout.Session.Mode;
    paymentIntent?: string | null;
    subscription?: string | null;
    /** The exclusion flags as Stripe holds them now. */
    invoiceMetadata?: Record<string, string>;
    subscriptionMetadata?: Record<string, string>;
    customerMetadata?: Record<string, string>;
    /** What the first invoice says was paid. Defaults to its whole total. */
    amountPaid?: number;
    invoiceStatus?: string;
    /** The first invoice's lines. Defaults to one subscription line making up the whole sale. */
    lines?: Stripe.InvoiceLineItem[];
    /** A one-time purchase's tax per rate on its Session read. Defaults to one exclusive rate carrying `tax`. */
    breakdownTaxes?: Array<{ amount: number; rate: { inclusive: boolean } }>;
    /** A Session read that comes back without a breakdown. */
    breakdown?: null;
    /** Stripe's answer for a deleted customer: no metadata, just the id and the deleted flag. */
    customerDeleted?: boolean;
  }): Stripe.Checkout.Session {
    const mode = opts.mode ?? "subscription";
    const amountTotal = opts.amountTotal ?? 5000;
    const tax = opts.tax ?? 0;
    // A subscription Session always names its subscription. Cases that do not
    // care which get their own, one per invoice.
    const subscription =
      opts.subscription !== undefined
        ? opts.subscription
        : mode === "subscription" && opts.invoice
          ? `sub_${opts.invoice}`
          : null;
    if (opts.invoice) {
      const shippingTotal = opts.shippingCost?.amount_total ?? 0;
      const shippingTax = opts.shippingCost?.amount_tax ?? 0;
      // The same sale as the Session, seen from its invoice read back with
      // its expansions. With no balance applied both give the same base, which
      // is why every older case keeps its figures.
      invoiceReadsById.set(opts.invoice, {
        id: opts.invoice,
        status: opts.invoiceStatus ?? "paid",
        metadata: opts.invoiceMetadata ?? {},
        customer: opts.customerDeleted
          ? { id: CUSTOMER_ID, deleted: true }
          : { id: CUSTOMER_ID, metadata: opts.customerMetadata ?? {} },
        parent: subscription
          ? {
              type: "subscription_details",
              subscription_details: { subscription: { id: subscription, metadata: opts.subscriptionMetadata ?? {} }, metadata: {} },
            }
          : null,
        total: amountTotal,
        total_excluding_tax: opts.totalDetails === null ? null : amountTotal - tax,
        total_taxes:
          opts.totalDetails === null ? null : tax ? [{ amount: tax, tax_behavior: "inclusive", taxable_amount: amountTotal - tax }] : [],
        amount_paid: opts.amountPaid ?? amountTotal,
        amount_paid_off_stripe: 0,
        shipping_cost: opts.shippingCost ? { amount_total: shippingTotal, amount_tax: shippingTax } : null,
      });
      linesByInvoice.set(
        opts.invoice,
        opts.lines ?? [invoiceLine({ amount: amountTotal - shippingTotal, inclusiveTax: tax - shippingTax, subscription })]
      );
    }
    const session = {
      id: `cs_${opts.invoice ?? opts.paymentIntent}`,
      mode,
      payment_status: opts.paymentStatus ?? "paid",
      created: Math.floor(Date.now() / 1000),
      metadata: { [REFERRAL_METADATA_KEY]: opts.metadataToken ?? clickInput.referralToken },
      customer: CUSTOMER_ID,
      customer_details: { email: "buyer@example.com" },
      amount_total: amountTotal,
      total_details:
        opts.totalDetails === null
          ? null
          : { amount_discount: 0, amount_shipping: opts.shippingCost?.amount_subtotal ?? 0, amount_tax: tax },
      shipping_cost: opts.shippingCost ?? null,
      currency: opts.currency ?? "usd",
      invoice: opts.invoice ?? null,
      payment_intent: opts.paymentIntent ?? null,
      subscription,
    } as unknown as Stripe.Checkout.Session;
    sessionsById.set(session.id, {
      ...session,
      total_details:
        opts.totalDetails === null
          ? null
          : {
              ...(session.total_details as unknown as Record<string, unknown>),
              breakdown:
                opts.breakdown === null
                  ? null
                  : { discounts: [], taxes: opts.breakdownTaxes ?? (tax ? [{ amount: tax, rate: { inclusive: false } }] : []) },
            },
      // The webhook Session's own `customer` field decides whether the read
      // carries a customer at all; a Session with none reads back null too.
      customer: session.customer
        ? opts.customerDeleted
          ? { id: CUSTOMER_ID, deleted: true }
          : { id: CUSTOMER_ID, metadata: opts.customerMetadata ?? {} }
        : null,
      invoice: opts.invoice ? { id: opts.invoice, metadata: opts.invoiceMetadata ?? {} } : null,
    });
    return session;
  }

  beforeEach(async () => {
    await clearAll();
    stripeStub.customers.retrieve.mockClear();
    stripeStub.subscriptions.retrieve.mockReset();
    stripeStub.subscriptions.retrieve.mockImplementation(async (id: string) => ({
      id,
      items: { data: [{ id: "si_1", price: { product: "prod_basic" } }], has_more: false },
    }));
    stripeStub.subscriptionItems.list.mockReset();
    stripeStub.subscriptionItems.list.mockImplementation(async () => ({ data: [], has_more: false }));
    stripeStub.invoicePayments.list.mockReset();
    stripeStub.invoicePayments.list.mockImplementation(async () => ({ data: [] }));
    stripeStub.paymentIntents.retrieve.mockReset();
    stripeStub.paymentIntents.retrieve.mockImplementation(async () => ({ id: "pi_test", latest_charge: null }));
    stripeStub.disputes.list.mockReset();
    stripeStub.disputes.list.mockImplementation(async () => ({ data: [] }));
    invoiceReadsById.clear();
    stripeStub.invoices.retrieve.mockReset();
    stripeStub.invoices.retrieve.mockImplementation(async (id: string) => {
      const read = invoiceReadsById.get(id);
      if (!read) {
        throw Object.assign(new Error(`No such invoice: ${id}`), { type: "StripeInvalidRequestError", code: "resource_missing" });
      }
      return read;
    });
    sessionsById.clear();
    stripeStub.checkout.sessions.retrieve.mockReset();
    stripeStub.checkout.sessions.retrieve.mockImplementation(async (id: string) => {
      const read = sessionsById.get(id);
      if (!read) {
        throw Object.assign(new Error(`No such checkout.session: ${id}`), { type: "StripeInvalidRequestError", code: "resource_missing" });
      }
      return read;
    });
    linesByInvoice.clear();
    stripeStub.invoices.listLineItems.mockReset();
    stripeStub.invoices.listLineItems.mockImplementation(async (id: string) => ({
      data: linesByInvoice.get(id) ?? [],
      has_more: false,
    }));

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

    clickInput = {
      affiliateId: affiliate.id,
      referralToken: "tok-1",
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    };
    click = await db.click.create({ data: clickInput });
  });

  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("earns a commission on a second purchase through the same click", async () => {
    // The cookie lives for ninety days. A returning customer who does not
    // re-click the link is the common case, not an edge one.
    await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_first" }));
    await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_second" }));

    const commissions = await db.commission.findMany({ where: { clickId: click.id } });
    expect(commissions).toHaveLength(2);
    // grossAmount is what a later partial refund prorates against, so it has
    // to be written at creation, equal to the commission itself.
    for (const commission of commissions) {
      expect(commission.grossAmount?.toString()).toBe(commission.amount.toString());
    }
  });

  it("creates nothing on a redelivery of the same session", async () => {
    const session = sessionFixture({ invoice: "in_first" });
    await handleCheckoutSessionCompleted(merchant, session);
    await handleCheckoutSessionCompleted(merchant, session);

    const commissions = await db.commission.findMany({ where: { clickId: click.id } });
    expect(commissions).toHaveLength(1);
  });

  it("gives each subscription to the click whose checkout started it, even for the same customer", async () => {
    const second = await db.click.create({ data: { ...clickInput, referralToken: "tok-2" } });
    await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_first", subscription: "sub_1" }));
    await handleCheckoutSessionCompleted(
      merchant,
      sessionFixture({ invoice: "in_second", metadataToken: "tok-2", subscription: "sub_2" })
    );

    const rows = await db.referredSubscription.findMany({ orderBy: { stripeSubscriptionId: "asc" } });
    expect(rows.map((r) => [r.stripeSubscriptionId, r.clickId])).toEqual([
      ["sub_1", click.id],
      ["sub_2", second.id],
    ]);
  });

  it("waits for a delayed payment to settle before creating anything", async () => {
    // SEPA and ACH complete the Session unpaid; the async success event brings
    // the same Session back paid.
    await handleCheckoutSessionCompleted(
      merchant,
      sessionFixture({ invoice: "in_first", paymentStatus: "unpaid", subscription: "sub_1" })
    );
    expect(await db.commission.count()).toBe(0);
    expect(await db.referredSubscription.count()).toBe(0);

    await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_first", subscription: "sub_1" }));
    expect(await db.commission.count()).toBe(1);
    expect(await db.referredSubscription.count()).toBe(1);
  });

  it("records a free trial's subscription with no first payment and creates no commission", async () => {
    await handleCheckoutSessionCompleted(
      merchant,
      sessionFixture({ invoice: "in_trial", paymentStatus: "no_payment_required", subscription: "sub_1" })
    );
    expect(await db.commission.count()).toBe(0);
    const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
    expect(referred.firstPaymentRef).toBeNull();
  });

  it("ignores a referral token that belongs to a different Merchant's affiliate", async () => {
    const other = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: merchant.ownerId,
        name: "Other",
        domain: `${crypto.randomUUID()}.example.com`,
        websiteUrl: "https://other.example.com",
        stripeSecretKeyEnc: "x",
      },
    });
    await handleCheckoutSessionCompleted(other, sessionFixture({ invoice: "in_other" }));

    expect(await db.commission.count()).toBe(0);
  });

  it("earns on the price before VAT when the price already includes it", async () => {
    // 120.00 paid, 20.00 of it VAT: the sale is 100.00 and 20% of it is 20.00.
    await handleCheckoutSessionCompleted(
      merchant,
      sessionFixture({ invoice: "in_vat", amountTotal: 12000, tax: 2000, currency: "eur" })
    );

    const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
    expect(commission.saleAmount?.toString()).toBe("100");
    expect(commission.amount.toString()).toBe("20");
    expect(commission.grossAmount?.toString()).toBe("20");
  });

  it("creates nothing when the only thing paid for was shipping", async () => {
    await handleCheckoutSessionCompleted(
      merchant,
      sessionFixture({
        invoice: "in_shipping",
        amountTotal: 500,
        shippingCost: { amount_subtotal: 500, amount_tax: 0, amount_total: 500 },
      })
    );
    expect(await db.commission.count()).toBe(0);
  });

  it("records nothing, and does not fail the event, when the tax cannot be read", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_notax", totalDetails: null }))
      ).resolves.toBeUndefined();
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      errors.mockRestore();
    }
    expect(await db.commission.count()).toBe(0);
  });

  it("applies a refund that happened before the commission was recorded", async () => {
    stripeStub.invoicePayments.list.mockImplementation(async () => ({
      data: [{ payment: { type: "payment_intent", payment_intent: "pi_early_refund" } }],
    }));
    stripeStub.paymentIntents.retrieve.mockImplementation(async () => ({
      id: "pi_early_refund",
      latest_charge: { id: "ch_early", amount: 5000, amount_refunded: 2500 },
    }));

    await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_early_refund" }));

    const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
    expect(commission.amount.toString()).toBe("5");
    expect(commission.grossAmount?.toString()).toBe("10");
    expect(commission.status).toBe("PENDING");
    expect(commission.voidReason).toBe("partial refund");
  });

  it("records a sale refunded in full already as voided", async () => {
    stripeStub.invoicePayments.list.mockImplementation(async () => ({
      data: [{ payment: { type: "payment_intent", payment_intent: "pi_full_refund" } }],
    }));
    stripeStub.paymentIntents.retrieve.mockImplementation(async () => ({
      id: "pi_full_refund",
      latest_charge: { id: "ch_full", amount: 5000, amount_refunded: 5000 },
    }));

    await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_full_refund" }));

    const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
    expect(commission.status).toBe("VOIDED");
    expect(commission.voidReason).toBe("refund");
    expect(commission.voidedAt).not.toBeNull();
  });

  it("still records the commission when the charge lookup fails", async () => {
    // An older key without Charges read can be refused with more than one
    // error type; an invalid request is used here, and the handler must not
    // care which.
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    stripeStub.invoicePayments.list.mockImplementation(async () => ({
      data: [{ payment: { type: "payment_intent", payment_intent: "pi_old_key" } }],
    }));
    stripeStub.paymentIntents.retrieve.mockImplementation(async () => {
      throw Object.assign(new Error("invalid request"), { type: "StripeInvalidRequestError", statusCode: 400 });
    });
    try {
      await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_old_key" }));
      expect(warnings).toHaveBeenCalledTimes(1);
    } finally {
      warnings.mockRestore();
    }

    const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
    expect(commission.amount.toString()).toBe("10");
    expect(commission.status).toBe("PENDING");
  });

  it("still records the commission when the invoice payment lookup fails", async () => {
    // Same fallback as the charge lookup above, but for the earlier step:
    // finding the PaymentIntent behind a subscription invoice at all.
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    stripeStub.invoicePayments.list.mockImplementation(async () => {
      throw Object.assign(new Error("invalid request"), { type: "StripeInvalidRequestError", statusCode: 400 });
    });
    try {
      await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_list_fails" }));
      expect(warnings).toHaveBeenCalledTimes(1);
    } finally {
      warnings.mockRestore();
    }

    expect(stripeStub.paymentIntents.retrieve).not.toHaveBeenCalled();
    const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
    expect(commission.amount.toString()).toBe("10");
    expect(commission.grossAmount?.toString()).toBe("10");
    expect(commission.status).toBe("PENDING");
  });

  it("applies a refund on a one-time purchase, made before the commission was recorded", async () => {
    // Payment-mode Checkout Sessions have no Invoice at all: the
    // PaymentIntent on the Session is the only trace back to the Charge, so
    // the invoice lookup must not run and paymentIntents.retrieve must be
    // called directly with the Session's own PaymentIntent id.
    stripeStub.paymentIntents.retrieve.mockImplementation(async () => ({
      id: "pi_one_time",
      latest_charge: { id: "ch_one_time", amount: 5000, amount_refunded: 2500 },
    }));

    await handleCheckoutSessionCompleted(
      merchant,
      sessionFixture({ mode: "payment", paymentIntent: "pi_one_time", invoice: null })
    );

    expect(stripeStub.invoicePayments.list).not.toHaveBeenCalled();
    expect(stripeStub.paymentIntents.retrieve).toHaveBeenCalledWith("pi_one_time", { expand: ["latest_charge"] });
    const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
    expect(commission.amount.toString()).toBe("5");
    expect(commission.grossAmount?.toString()).toBe("10");
    expect(commission.status).toBe("PENDING");
    expect(commission.voidReason).toBe("partial refund");
    // Payment-mode Sessions never carry a subscription, so nothing is recorded.
    expect(await db.referredSubscription.count()).toBe(0);
  });

  describe("a dispute made before the commission was recorded", () => {
    function disputedCharge(paymentIntent: string) {
      stripeStub.invoicePayments.list.mockImplementation(async () => ({
        data: [{ payment: { type: "payment_intent", payment_intent: paymentIntent } }],
      }));
      stripeStub.paymentIntents.retrieve.mockImplementation(async () => ({
        id: paymentIntent,
        latest_charge: { id: "ch_disputed", amount: 5000, amount_refunded: 0, disputed: true },
      }));
    }

    it("holds the commission while the dispute is open", async () => {
      disputedCharge("pi_disputed");
      stripeStub.disputes.list.mockImplementation(async () => ({ data: [{ id: "dp_1", status: "needs_response" }] }));

      await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_disputed" }));

      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.status).toBe("PENDING");
      expect(commission.amount.toString()).toBe("10");
      expect(commission.disputeOpenedAt).not.toBeNull();
      expect(stripeStub.disputes.list).toHaveBeenCalledWith({ payment_intent: "pi_disputed", limit: 100 });
    });

    it("records the commission voided when the chargeback was already lost", async () => {
      disputedCharge("pi_lost");
      stripeStub.disputes.list.mockImplementation(async () => ({ data: [{ id: "dp_1", status: "lost" }] }));

      await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_lost" }));

      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.status).toBe("VOIDED");
      expect(commission.voidReason).toBe("chargeback");
    });

    it("holds the commission, and logs, when the disputes cannot be read", async () => {
      const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
      disputedCharge("pi_unreadable");
      stripeStub.disputes.list.mockImplementation(async () => {
        throw Object.assign(new Error("permission"), { type: "StripePermissionError", statusCode: 403 });
      });
      let commissionId: string;
      try {
        await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_unreadable" }));
        const created = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
        commissionId = created.id;
        // One line from the failed list read itself, one from the commission
        // being created held because of it.
        expect(warnings).toHaveBeenCalledTimes(2);
        expect(warnings).toHaveBeenCalledWith(expect.stringContaining(commissionId));
      } finally {
        warnings.mockRestore();
      }

      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.status).toBe("PENDING");
      expect(commission.disputeOpenedAt).not.toBeNull();
    });

    it("holds the commission, and logs, when a disputed charge's dispute list is still empty", async () => {
      // A disputed charge always has at least one dispute, so an empty list
      // is the opening event having arrived and been dropped before this row
      // existed, not a charge cleared of every dispute.
      const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
      disputedCharge("pi_lagging");
      try {
        await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_lagging" }));
        const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
        expect(warnings).toHaveBeenCalledTimes(1);
        expect(warnings).toHaveBeenCalledWith(expect.stringContaining(commission.id));
      } finally {
        warnings.mockRestore();
      }

      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.status).toBe("PENDING");
      expect(commission.disputeOpenedAt).not.toBeNull();
    });

    it("records the commission as usual when the dispute was already won", async () => {
      disputedCharge("pi_won");
      stripeStub.disputes.list.mockImplementation(async () => ({ data: [{ id: "dp_1", status: "won" }] }));

      await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_won" }));

      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.status).toBe("PENDING");
      expect(commission.disputeOpenedAt).toBeNull();
    });

    it("does not look for disputes on a charge that was never disputed", async () => {
      stripeStub.paymentIntents.retrieve.mockImplementation(async () => ({
        id: "pi_quiet",
        latest_charge: { id: "ch_quiet", amount: 5000, amount_refunded: 0, disputed: false },
      }));

      await handleCheckoutSessionCompleted(merchant, sessionFixture({ mode: "payment", paymentIntent: "pi_quiet", invoice: null }));

      expect(stripeStub.disputes.list).not.toHaveBeenCalled();
      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.disputeOpenedAt).toBeNull();
    });
  });

  it("records a dong sale larger than the ledger used to hold", async () => {
    // VND has no minor unit, so amount_total is the sale itself.
    await handleCheckoutSessionCompleted(
      merchant,
      sessionFixture({ invoice: "in_vnd", amountTotal: 250_000_000_000, currency: "vnd" })
    );

    const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
    expect(commission.saleAmount?.toString()).toBe("250000000000");
    expect(commission.amount.toString()).toBe("50000000000");
  });

  it("records the subscription it created against the click, with this payment as its first", async () => {
    const session = sessionFixture({ invoice: "in_first", subscription: "sub_1" });
    await handleCheckoutSessionCompleted(merchant, session);

    const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
    expect(referred.clickId).toBe(click.id);
    expect(referred.merchantId).toBe(merchant.id);
    expect(referred.firstPaymentRef).toBe("in_first");
    expect(referred.firstPaidAt?.getTime()).toBe(session.created * 1000);
    // The customer link renewals used to ride on is no longer written.
    expect((await db.click.findUniqueOrThrow({ where: { id: click.id } })).stripeCustomerId).toBeNull();
  });

  it("records the subscription once on a redelivery, without moving its first payment", async () => {
    const session = sessionFixture({ invoice: "in_first", subscription: "sub_1" });
    await handleCheckoutSessionCompleted(merchant, session);
    const first = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });

    await handleCheckoutSessionCompleted(merchant, session);

    expect(await db.referredSubscription.count()).toBe(1);
    const after = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
    expect(after.firstPaymentRef).toBe(first.firstPaymentRef);
    expect(after.firstPaidAt?.getTime()).toBe(first.firstPaidAt?.getTime());
  });

  describe("the products a referral bought", () => {
    const stripeFailure = (type: string) => Object.assign(new Error(type), { type });

    it("records the products the subscription bills, for its renewals to earn on", async () => {
      stripeStub.subscriptions.retrieve.mockImplementation(async (id: string) => ({
        id,
        items: {
          data: [
            { id: "si_1", price: { product: "prod_seats" } },
            { id: "si_2", price: { product: { id: "prod_pro" } } },
          ],
          has_more: false,
        },
      }));

      await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_first", subscription: "sub_1" }));

      const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
      expect(referred.stripeProductIds).toEqual(["prod_pro", "prod_seats"]);
      expect(stripeStub.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
    });

    it("does not re-read products it already has on a redelivery", async () => {
      stripeStub.subscriptions.retrieve.mockImplementation(async (id: string) => ({
        id,
        items: {
          data: [
            { id: "si_1", price: { product: "prod_seats" } },
            { id: "si_2", price: { product: { id: "prod_pro" } } },
          ],
          has_more: false,
        },
      }));
      const session = sessionFixture({ invoice: "in_first", subscription: "sub_1" });

      await handleCheckoutSessionCompleted(merchant, session);
      stripeStub.subscriptions.retrieve.mockClear();
      stripeStub.subscriptionItems.list.mockClear();
      await handleCheckoutSessionCompleted(merchant, session);

      expect(stripeStub.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(stripeStub.subscriptionItems.list).not.toHaveBeenCalled();
      const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
      expect(referred.stripeProductIds).toEqual(["prod_pro", "prod_seats"]);
    });

    it("still records the subscription and the sale's commission when the key cannot read its products", async () => {
      const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
      stripeStub.subscriptions.retrieve.mockImplementation(async () => {
        throw stripeFailure("StripePermissionError");
      });
      try {
        await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_first", subscription: "sub_1" }));
        expect(warnings).toHaveBeenCalledTimes(1);
      } finally {
        warnings.mockRestore();
      }

      // The subscription read failed, but the first invoice's own lines still
      // name the product, the same recovery a renewal gets when it learns the
      // products from an invoice it can already read.
      const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
      expect(referred.stripeProductIds).toEqual(["prod_basic"]);
      expect(await db.commission.count({ where: { clickId: click.id } })).toBe(1);
    });

    it("fills the products on a redelivery after the first delivery could not read them", async () => {
      const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
      stripeStub.subscriptions.retrieve.mockRejectedValueOnce(stripeFailure("StripePermissionError"));
      const session = sessionFixture({ invoice: "in_first", subscription: "sub_1" });
      try {
        await handleCheckoutSessionCompleted(merchant, session);
        await handleCheckoutSessionCompleted(merchant, session);
      } finally {
        warnings.mockRestore();
      }

      const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
      expect(referred.stripeProductIds).toEqual(["prod_basic"]);
    });

    it("throws before recording anything when Stripe cannot be reached, so the event is retried", async () => {
      stripeStub.subscriptions.retrieve.mockImplementation(async () => {
        throw stripeFailure("StripeConnectionError");
      });

      await expect(
        handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_first", subscription: "sub_1" }))
      ).rejects.toThrow("StripeConnectionError");

      expect(await db.referredSubscription.count()).toBe(0);
      expect(await db.commission.count()).toBe(0);
    });

    it("asks nothing about products on a one-time purchase", async () => {
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ mode: "payment", paymentIntent: "pi_one_time", invoice: null, subscription: null })
      );
      expect(stripeStub.subscriptions.retrieve).not.toHaveBeenCalled();
    });
  });

  it("dates a delayed payment's first payment from the session, not from when it settled", async () => {
    // SEPA/ACH: checkout.session.completed arrives unpaid the moment the
    // buyer checks out. checkout.session.async_payment_succeeded brings the
    // same Session back, now paid, once the debit actually clears days
    // later. Stripe starts the subscription, and schedules every renewal,
    // from the Session itself, so FIXED_MONTHS must count from there too, or
    // the month N+1 renewal lands inside a window stretched by the delay.
    const session = sessionFixture({ invoice: "in_first", subscription: "sub_1", paymentStatus: "unpaid" });
    await handleCheckoutSessionCompleted(merchant, session);

    const settledAt = session.created + 5 * 24 * 60 * 60;
    await handleCheckoutSessionCompleted(merchant, { ...session, payment_status: "paid" });

    const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
    expect(referred.firstPaidAt?.getTime()).toBe(session.created * 1000);
    expect(referred.firstPaidAt?.getTime()).not.toBe(settledAt * 1000);
  });

  it("does not let a bank-debit delay push a FIXED_MONTHS renewal back into its earning window", async () => {
    // A 3-month FIXED_MONTHS program. The buyer pays by SEPA debit, which
    // settles 5 days after checkout; Stripe still schedules the subscription,
    // and its renewals, from the Session's own timestamp. The month-3 renewal
    // must not earn just because the claimed first payment was mistakenly
    // dated from the settlement event instead.
    const program = await db.program.create({
      data: {
        slug: crypto.randomUUID(),
        merchantId: merchant.id,
        name: "Fixed Three",
        defaultCommissionRate: 20,
        commissionDurationType: "FIXED_MONTHS",
        commissionDurationMonths: 3,
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
    const fixedClick = await db.click.create({
      data: { ...clickInput, affiliateId: affiliate.id, referralToken: "tok-fixed" },
    });

    const session = sessionFixture({
      invoice: "in_fixed_first",
      subscription: "sub_fixed",
      paymentStatus: "unpaid",
      metadataToken: "tok-fixed",
    });
    await handleCheckoutSessionCompleted(merchant, session);
    await handleCheckoutSessionCompleted(merchant, { ...session, payment_status: "paid" });

    const renewalAt = new Date(session.created * 1000);
    renewalAt.setUTCMonth(renewalAt.getUTCMonth() + 3);
    const { handleInvoicePaid } = await import("@/lib/worker/handlers/invoicePaid");
    await handleInvoicePaid(merchant, {
      id: "in_fixed_renewal",
      customer: CUSTOMER_ID,
      billing_reason: "subscription_cycle",
      created: Math.floor(renewalAt.getTime() / 1000),
      currency: "usd",
      customer_email: "buyer@example.com",
      metadata: {},
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_fixed", metadata: {} } },
      total: 5000,
      total_excluding_tax: 5000,
      total_taxes: [],
      amount_paid: 5000,
      shipping_cost: null,
    } as unknown as Stripe.Invoice);

    expect(await db.commission.count({ where: { clickId: fixedClick.id } })).toBe(1); // the checkout commission only
    const commissions = await db.commission.findMany({ where: { clickId: fixedClick.id } });
    expect(commissions.map((c) => c.stripePaymentRef)).toEqual(["in_fixed_first"]);
  });

  it("claims no first payment on a trial Stripe reports as paid with a zero total", async () => {
    // Stripe marks a trial checkout paid once its $0 trial invoice is processed.
    await handleCheckoutSessionCompleted(
      merchant,
      sessionFixture({ invoice: "in_trial", amountTotal: 0, subscription: "sub_1" })
    );
    expect(await db.commission.count()).toBe(0);
    const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
    expect(referred.firstPaymentRef).toBeNull();
  });

  it("still records the subscription when this one purchase is excluded, so its renewals can earn", async () => {
    // The customer comes back expanded on the invoice the sale created.
    await handleCheckoutSessionCompleted(
      merchant,
      sessionFixture({ invoice: "in_first", subscription: "sub_1", customerMetadata: { supaffi: "false" } })
    );

    expect(await db.commission.count()).toBe(0);
    const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
    expect(referred.firstPaymentRef).toBe("in_first");
  });

  describe("exclusion", () => {
    const FLAG = { supaffi: "false" };

    it("earns nothing when the subscription the checkout started is excluded, and still claims its first payment", async () => {
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ invoice: "in_first", subscription: "sub_1", subscriptionMetadata: FLAG })
      );

      expect(await db.commission.count()).toBe(0);
      expect(stripeStub.invoices.retrieve).toHaveBeenCalledWith("in_first", { expand: EARNING_INVOICE_EXPAND });
      // Only the products read; the flag came from the invoice's expansion.
      expect(stripeStub.subscriptions.retrieve).toHaveBeenCalledTimes(1);
      const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
      expect(referred.firstPaymentRef).toBe("in_first");
    });

    it("earns nothing when a delayed payment on an excluded subscription settles", async () => {
      const session = sessionFixture({
        invoice: "in_first",
        subscription: "sub_1",
        paymentStatus: "unpaid",
        subscriptionMetadata: FLAG,
      });

      // checkout.session.completed arrives unpaid, then
      // checkout.session.async_payment_succeeded brings the same Session paid.
      await handleCheckoutSessionCompleted(merchant, session);
      await handleCheckoutSessionCompleted(merchant, { ...session, payment_status: "paid" });

      expect(await db.commission.count()).toBe(0);
    });

    it("earns nothing when the checkout's invoice is excluded", async () => {
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ invoice: "in_first", subscription: "sub_1", invoiceMetadata: FLAG })
      );

      expect(await db.commission.count()).toBe(0);
    });

    it("earns nothing on a one-time purchase whose post-purchase invoice is excluded, read from the Session", async () => {
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ mode: "payment", paymentIntent: "pi_once", invoice: "in_post", invoiceMetadata: FLAG })
      );

      expect(await db.commission.count()).toBe(0);
      expect(stripeStub.invoices.retrieve).not.toHaveBeenCalled();
      expect(stripeStub.customers.retrieve).not.toHaveBeenCalled();
    });

    it("records no commission and fails the event, so it is retried, when the invoice cannot be read", async () => {
      stripeStub.invoices.retrieve.mockRejectedValueOnce(
        Object.assign(new Error("Stripe is unavailable"), { type: "StripeConnectionError" })
      );
      const session = sessionFixture({ invoice: "in_first", subscription: "sub_1" });

      await expect(handleCheckoutSessionCompleted(merchant, session)).rejects.toThrow("Stripe is unavailable");
      expect(await db.commission.count()).toBe(0);

      // The retry, once Stripe answers, earns as usual and keeps the first payment.
      await handleCheckoutSessionCompleted(merchant, session);
      expect(await db.commission.count()).toBe(1);
      const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
      expect(referred.firstPaymentRef).toBe("in_first");
    });

    it("reads the subscription by id when Stripe did not expand it, and fails the event if that read fails", async () => {
      const session = sessionFixture({ invoice: "in_first", subscription: "sub_1" });
      invoiceReadsById.set("in_first", {
        ...invoiceReadsById.get("in_first"),
        parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: {} } },
      });
      // The products read comes first and answers; the exclusion read fails.
      stripeStub.subscriptions.retrieve
        .mockResolvedValueOnce({ id: "sub_1", items: { data: [{ id: "si_1", price: { product: "prod_basic" } }], has_more: false } })
        .mockRejectedValueOnce(Object.assign(new Error("Stripe is unavailable"), { type: "StripeConnectionError" }));

      await expect(handleCheckoutSessionCompleted(merchant, session)).rejects.toThrow(/sub_1.*retried/);
      expect(await db.commission.count()).toBe(0);
    });

    it("checks a subscription checkout nothing excludes with one read", async () => {
      await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_first", subscription: "sub_1" }));

      expect(await db.commission.count()).toBe(1);
      expect(stripeStub.invoices.retrieve).toHaveBeenCalledTimes(1);
      expect(stripeStub.customers.retrieve).not.toHaveBeenCalled();
    });

    it("reads only the Session on a one-time purchase without an invoice", async () => {
      await handleCheckoutSessionCompleted(merchant, sessionFixture({ mode: "payment", paymentIntent: "pi_once", invoice: null }));

      expect(await db.commission.count()).toBe(1);
      expect(stripeStub.checkout.sessions.retrieve).toHaveBeenCalledTimes(1);
      expect(stripeStub.customers.retrieve).not.toHaveBeenCalled();
      expect(stripeStub.invoices.retrieve).not.toHaveBeenCalled();
    });

    it("reads nothing to check exclusion on a checkout that cannot earn", async () => {
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ invoice: "in_trial", paymentStatus: "no_payment_required", subscription: "sub_1" })
      );
      await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_zero", amountTotal: 0, subscription: "sub_2" }));

      expect(await db.commission.count()).toBe(0);
      expect(stripeStub.invoices.retrieve).not.toHaveBeenCalled();
      expect(stripeStub.customers.retrieve).not.toHaveBeenCalled();
    });

    it("reads nothing to check exclusion when the Session is not yet paid", async () => {
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ invoice: "in_delayed", subscription: "sub_delayed", paymentStatus: "unpaid" })
      );

      expect(await db.commission.count()).toBe(0);
      expect(stripeStub.invoices.retrieve).not.toHaveBeenCalled();
      expect(stripeStub.customers.retrieve).not.toHaveBeenCalled();
    });

    it("reads nothing to check exclusion once a self referral was confirmed on the click", async () => {
      await db.click.update({ where: { id: click.id }, data: { fraudConfirmedAt: new Date() } });

      await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_first", subscription: "sub_1" }));

      expect(await db.commission.count()).toBe(0);
      expect(stripeStub.invoices.retrieve).not.toHaveBeenCalled();
      expect(stripeStub.customers.retrieve).not.toHaveBeenCalled();
    });

    it("reads nothing to check exclusion on a Session with neither an invoice nor a payment intent to key on", async () => {
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ mode: "payment", invoice: null, paymentIntent: null, subscription: null })
      );

      expect(await db.commission.count()).toBe(0);
      expect(stripeStub.invoices.retrieve).not.toHaveBeenCalled();
      expect(stripeStub.customers.retrieve).not.toHaveBeenCalled();
    });

    it("reads nothing to check exclusion once a one-time program's duration is already used up", async () => {
      await db.program.updateMany({ where: { merchantId: merchant.id }, data: { commissionDurationType: "ONE_TIME" } });
      await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_a", subscription: "sub_a" }));
      expect(await db.commission.count()).toBe(1);

      stripeStub.invoices.retrieve.mockClear();
      stripeStub.customers.retrieve.mockClear();
      await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_b", subscription: "sub_b" }));

      expect(await db.commission.count()).toBe(1);
      // The subscription's first invoice is still read to judge whether money
      // moved and claim the first payment, regardless of whether the click's
      // duration allows it to earn; only the exclusion-specific reads below
      // that check are skipped, since referralStillEarns stops before them.
      expect(stripeStub.invoices.retrieve).toHaveBeenCalledTimes(1);
      expect(stripeStub.customers.retrieve).not.toHaveBeenCalled();
    });

    it("earns nothing when the checkout's customer was deleted, logging the sale once with no customer id", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ invoice: "in_first", subscription: "sub_1", customerDeleted: true })
      );

      expect(await db.commission.count()).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("in_first");
      expect(warn.mock.calls[0][0]).not.toContain(CUSTOMER_ID);

      warn.mockRestore();
    });
  });

  it("creates nothing once a self referral was confirmed on the click, but still proves tracking works", async () => {
    await db.click.update({ where: { id: click.id }, data: { fraudConfirmedAt: new Date() } });

    await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_first", subscription: "sub_1" }));

    expect(await db.commission.count()).toBe(0);
    expect(await db.referredSubscription.count()).toBe(0);
    expect((await db.merchant.findUniqueOrThrow({ where: { id: merchant.id } })).trackingVerifiedAt).not.toBeNull();
  });

  it("creates nothing when the self referral is confirmed while the sale is being processed", async () => {
    // Confirmed after the handler's first check on the click, during its
    // Stripe reads, and before it writes.
    stripeStub.invoicePayments.list.mockImplementationOnce(async () => {
      await db.click.update({ where: { id: click.id }, data: { fraudConfirmedAt: new Date() } });
      return { data: [] };
    });

    await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_first", subscription: "sub_1" }));

    expect(await db.commission.count()).toBe(0);
  });

  describe("one duration per referral", () => {
    const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

    async function useDuration(type: "ONE_TIME" | "FIXED_MONTHS", months: number | null = null) {
      await db.program.updateMany({
        where: { merchantId: merchant.id },
        data: { commissionDurationType: type, commissionDurationMonths: months },
      });
    }

    function checkoutOn(iso: string, opts: Parameters<typeof sessionFixture>[0]): Stripe.Checkout.Session {
      return { ...sessionFixture(opts), created: at(iso) } as Stripe.Checkout.Session;
    }

    // Only renewals that must not earn are sent here. They return at the
    // duration check, before anything reads the invoice's lines.
    function renewalOn(iso: string, id: string, subscription: string): Stripe.Invoice {
      return {
        id,
        customer: CUSTOMER_ID,
        billing_reason: "subscription_cycle",
        created: at(iso),
        currency: "usd",
        customer_email: "buyer@example.com",
        metadata: {},
        parent: { type: "subscription_details", subscription_details: { subscription, metadata: {} } },
        total: 5000,
        total_excluding_tax: 5000,
        total_taxes: [],
        amount_paid: 5000,
        shipping_cost: null,
      } as unknown as Stripe.Invoice;
    }

    async function cancel(subscription: string) {
      await handleSubscriptionDeleted(merchant, { id: subscription, customer: CUSTOMER_ID } as unknown as Stripe.Subscription);
    }

    function refundedInFull(intent: string) {
      stripeStub.invoicePayments.list.mockImplementationOnce(async () => ({
        data: [{ payment: { type: "payment_intent", payment_intent: intent } }],
      }));
      stripeStub.paymentIntents.retrieve.mockImplementationOnce(async () => ({
        id: intent,
        latest_charge: { id: `ch_${intent}`, amount: 5000, amount_refunded: 5000, disputed: false },
      }));
    }

    async function earnedRefs() {
      const rows = await db.commission.findMany({ where: { clickId: click.id } });
      return rows.map((c) => c.stripePaymentRef).sort();
    }

    it("pays a one-time program nothing when the customer cancels and subscribes again through the same click", async () => {
      await useDuration("ONE_TIME");
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-01-10T00:00:00Z", { invoice: "in_a", subscription: "sub_a" }));
      await cancel("sub_a");
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-02-20T00:00:00Z", { invoice: "in_b", subscription: "sub_b" }));

      expect(await earnedRefs()).toEqual(["in_a"]);
      // The new subscription is still recorded, with its own first payment.
      const resubscribed = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_b" } });
      expect(resubscribed.firstPaymentRef).toBe("in_b");
    });

    it("keeps a fixed-months window running from the first subscription when the customer cancels and subscribes again", async () => {
      await useDuration("FIXED_MONTHS", 3);
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-01-10T00:00:00Z", { invoice: "in_a", subscription: "sub_a" }));
      await cancel("sub_a");
      // Inside the three months that started on January 10, so it earns.
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-02-20T00:00:00Z", { invoice: "in_b", subscription: "sub_b" }));
      // Inside sub_b's own three months, past the referral's.
      await handleInvoicePaid(merchant, renewalOn("2026-04-20T00:00:00Z", "in_b_3", "sub_b"));
      await cancel("sub_b");
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-04-25T00:00:00Z", { invoice: "in_c", subscription: "sub_c" }));

      expect(await earnedRefs()).toEqual(["in_a", "in_b"]);
    });

    it("earns nothing on a switch from monthly to annual through a new Checkout after the window ended", async () => {
      await useDuration("FIXED_MONTHS", 3);
      await handleCheckoutSessionCompleted(
        merchant,
        checkoutOn("2026-01-15T00:00:00Z", { invoice: "in_monthly", subscription: "sub_monthly" })
      );
      await cancel("sub_monthly");
      await handleCheckoutSessionCompleted(
        merchant,
        checkoutOn("2026-05-01T00:00:00Z", { invoice: "in_annual", subscription: "sub_annual", amountTotal: 50000 })
      );

      expect(await earnedRefs()).toEqual(["in_monthly"]);
    });

    it("pays a one-time program nothing on a switch from monthly to annual through a new Checkout", async () => {
      await useDuration("ONE_TIME");
      await handleCheckoutSessionCompleted(
        merchant,
        checkoutOn("2026-01-15T00:00:00Z", { invoice: "in_monthly", subscription: "sub_monthly" })
      );
      await cancel("sub_monthly");
      await handleCheckoutSessionCompleted(
        merchant,
        checkoutOn("2026-02-01T00:00:00Z", { invoice: "in_annual", subscription: "sub_annual", amountTotal: 50000 })
      );

      expect(await earnedRefs()).toEqual(["in_monthly"]);
    });

    it("pays a one-time program once for two subscriptions bought through one click at the same moment", async () => {
      await useDuration("ONE_TIME");
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-03-01T00:00:00Z", { invoice: "in_a", subscription: "sub_a" }));
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-03-01T00:00:00Z", { invoice: "in_b", subscription: "sub_b" }));

      expect(await earnedRefs()).toEqual(["in_a"]);
    });

    it("pays a one-time program nothing on a subscription bought after a one-time purchase through the same click", async () => {
      await useDuration("ONE_TIME");
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-01-10T00:00:00Z", { mode: "payment", paymentIntent: "pi_once" }));
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-02-10T00:00:00Z", { invoice: "in_sub", subscription: "sub_1" }));

      expect(await earnedRefs()).toEqual(["pi_once"]);
    });

    it("starts a fixed-months window at a one-time purchase made before any subscription", async () => {
      await useDuration("FIXED_MONTHS", 3);
      // Recorded when that purchase was processed; a one-time sale keeps no other date.
      await db.commission.create({
        data: {
          affiliateId: clickInput.affiliateId,
          clickId: click.id,
          stripePaymentRef: "pi_once",
          amount: 10,
          grossAmount: 10,
          currency: "usd",
          payableAt: new Date("2026-02-09T00:00:00Z"),
          createdAt: new Date("2026-01-10T00:00:00Z"),
        },
      });
      // Inside the three months that started on January 10, so it earns.
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-03-01T00:00:00Z", { invoice: "in_sub", subscription: "sub_1" }));
      await handleInvoicePaid(merchant, renewalOn("2026-04-20T00:00:00Z", "in_sub_2", "sub_1"));
      await cancel("sub_1");
      // Past the referral's window, which ended on April 10.
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-04-25T00:00:00Z", { invoice: "in_sub_again", subscription: "sub_2" }));

      expect(await earnedRefs()).toEqual(["in_sub", "pi_once"]);
    });

    it("counts a refunded first payment as the one-time commission already used", async () => {
      await useDuration("ONE_TIME");
      refundedInFull("pi_a");
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-01-10T00:00:00Z", { invoice: "in_a", subscription: "sub_a" }));
      await cancel("sub_a");
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-01-20T00:00:00Z", { invoice: "in_b", subscription: "sub_b" }));

      const rows = await db.commission.findMany({ where: { clickId: click.id } });
      expect(rows.map((c) => [c.stripePaymentRef, c.status, c.voidReason])).toEqual([["in_a", "VOIDED", "refund"]]);
    });

    it("starts a fixed-months window at a refunded first payment", async () => {
      await useDuration("FIXED_MONTHS", 3);
      refundedInFull("pi_a");
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-01-10T00:00:00Z", { invoice: "in_a", subscription: "sub_a" }));
      await cancel("sub_a");
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-04-20T00:00:00Z", { invoice: "in_b", subscription: "sub_b" }));

      expect(await earnedRefs()).toEqual(["in_a"]);
    });

    it("measures a click from before 0.2.5, with commissions but no recorded subscription, from its first commission", async () => {
      await useDuration("FIXED_MONTHS", 3);
      await db.commission.create({
        data: {
          affiliateId: clickInput.affiliateId,
          clickId: click.id,
          stripePaymentRef: "in_legacy",
          amount: 10,
          grossAmount: 10,
          currency: "usd",
          status: "PAID",
          paidAt: new Date("2026-02-15T00:00:00Z"),
          payableAt: new Date("2026-02-09T00:00:00Z"),
          createdAt: new Date("2026-01-10T00:00:00Z"),
        },
      });
      await handleCheckoutSessionCompleted(merchant, checkoutOn("2026-05-01T00:00:00Z", { invoice: "in_new", subscription: "sub_new" }));

      expect(await earnedRefs()).toEqual(["in_legacy"]);
    });
  });

  it("records no subscription for a token that belongs to a different Merchant's affiliate", async () => {
    const other = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: merchant.ownerId,
        name: "Other",
        domain: `${crypto.randomUUID()}.example.com`,
        websiteUrl: "https://other.example.com",
        stripeSecretKeyEnc: "x",
      },
    });
    await handleCheckoutSessionCompleted(other, sessionFixture({ invoice: "in_other", subscription: "sub_1" }));

    expect(await db.referredSubscription.count()).toBe(0);
  });

  describe("a subscription's first payment", () => {
    function chargeOnFirstInvoice(amount: number, refunded: number) {
      stripeStub.invoicePayments.list.mockImplementation(async () => ({
        data: [{ payment: { type: "payment_intent", payment_intent: "pi_first" } }],
      }));
      stripeStub.paymentIntents.retrieve.mockImplementation(async () => ({
        id: "pi_first",
        latest_charge: { id: "ch_first", amount, amount_refunded: refunded, disputed: false },
      }));
    }

    it("earns only on the part credit balance did not cover, and claims it as the first payment", async () => {
      // 50.00 subscription, 40.00 of it from the customer's balance: 10.00
      // paid, so 20% earns 2.00, as a renewal would.
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ invoice: "in_partial", subscription: "sub_1", amountPaid: 1000 })
      );

      expect(stripeStub.invoices.retrieve).toHaveBeenCalledWith("in_partial", { expand: EARNING_INVOICE_EXPAND });
      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.amount.toString()).toBe("2");
      expect(commission.grossAmount?.toString()).toBe("2");
      expect(commission.saleAmount?.toString()).toBe("10");
      expect(commission.referredChargeMinor).toBe(1000n);
      const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
      expect(referred.firstPaymentRef).toBe("in_partial");
    });

    it("earns nothing and claims no first payment when credit balance covered all of it", async () => {
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ invoice: "in_covered", subscription: "sub_1", amountPaid: 0 })
      );

      expect(await db.commission.count()).toBe(0);
      expect(stripeStub.invoices.listLineItems).not.toHaveBeenCalled();
      // Recorded, like a free trial, so the first invoice that charges money
      // can earn and becomes the first payment.
      const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
      expect(referred.clickId).toBe(click.id);
      expect(referred.firstPaymentRef).toBeNull();
      expect(referred.firstPaidAt).toBeNull();
    });

    it("lets the first paid renewal start a one-time referral whose first payment credit balance covered", async () => {
      await db.program.updateMany({ where: { merchantId: merchant.id }, data: { commissionDurationType: "ONE_TIME" } });
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ invoice: "in_covered", subscription: "sub_1", amountPaid: 0 })
      );

      const renewal = (id: string) =>
        ({
          id,
          customer: CUSTOMER_ID,
          billing_reason: "subscription_cycle",
          created: Math.floor(Date.now() / 1000),
          currency: "usd",
          customer_email: "buyer@example.com",
          metadata: {},
          parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: {} } },
          total: 5000,
          total_excluding_tax: 5000,
          total_taxes: [],
          amount_paid: 5000,
          shipping_cost: null,
        }) as unknown as Stripe.Invoice;
      invoiceReadsById.set("in_renewal_1", {
        id: "in_renewal_1",
        total: 5000,
        amount_paid: 5000,
        amount_paid_off_stripe: 0,
        metadata: {},
        customer: { id: CUSTOMER_ID, metadata: {} },
        parent: { type: "subscription_details", subscription_details: { subscription: { id: "sub_1", metadata: {} }, metadata: {} } },
      });
      linesByInvoice.set("in_renewal_1", [invoiceLine({ amount: 5000, subscription: "sub_1" })]);

      await handleInvoicePaid(merchant, renewal("in_renewal_1"));
      // The one-time commission is spent; this returns before any read.
      await handleInvoicePaid(merchant, renewal("in_renewal_2"));

      const rows = await db.commission.findMany({ where: { clickId: click.id } });
      expect(rows.map((row) => row.stripePaymentRef)).toEqual(["in_renewal_1"]);
      const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
      expect(referred.firstPaymentRef).toBe("in_renewal_1");
    });

    it("earns nothing on a one-time price sold in the same Checkout", async () => {
      // 50.00 plan plus a 20.00 setup fee on the first invoice.
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({
          invoice: "in_with_fee",
          subscription: "sub_1",
          amountTotal: 7000,
          lines: [invoiceLine({ amount: 5000, subscription: "sub_1" }), invoiceLine({ amount: 2000, source: "invoice_item" })],
        })
      );

      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.saleAmount?.toString()).toBe("50");
      expect(commission.amount.toString()).toBe("10");
      expect(commission.referredChargeMinor).toBe(5000n);
    });

    it("claims the first payment but earns nothing on a first invoice that bills only a one-time price", async () => {
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({
          invoice: "in_setup",
          subscription: "sub_1",
          amountTotal: 2000,
          lines: [invoiceLine({ amount: 2000, source: "invoice_item" })],
        })
      );

      expect(await db.commission.count()).toBe(0);
      const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
      expect(referred.firstPaymentRef).toBe("in_setup");
    });

    it("takes a refund of the first payment out of the referred share first", async () => {
      // 50.00 plan and a 50.00 fee on one charge; 50.00 refunded before the
      // event was processed takes all of the referred share.
      chargeOnFirstInvoice(10000, 5000);

      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({
          invoice: "in_refunded",
          subscription: "sub_1",
          amountTotal: 10000,
          lines: [invoiceLine({ amount: 5000, subscription: "sub_1" }), invoiceLine({ amount: 5000, source: "invoice_item" })],
        })
      );

      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.status).toBe("VOIDED");
      expect(commission.voidReason).toBe("refund");
      expect(commission.referredChargeMinor).toBe(5000n);
    });

    it("stores the exact share, and earns, on a very large first payment", async () => {
      // 250,000,000,000.00 VND (zero-decimal), well past the old INTEGER
      // column's 2,147,483,647 limit, but far inside the BIGINT column and
      // Number.MAX_SAFE_INTEGER, so it is stored exactly rather than dropped.
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ invoice: "in_vnd_share", subscription: "sub_1", amountTotal: 250_000_000_000, currency: "vnd" })
      );

      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.referredChargeMinor).toBe(250_000_000_000n);
      expect(commission.amount.toString()).toBe("50000000000");
    });

    it("writes nothing and fails the event so it retries when the invoice cannot be read", async () => {
      stripeStub.invoices.retrieve.mockRejectedValueOnce(
        Object.assign(new Error("connection reset"), { type: "StripeConnectionError" })
      );
      const session = sessionFixture({ invoice: "in_retry", subscription: "sub_1" });

      await expect(handleCheckoutSessionCompleted(merchant, session)).rejects.toThrow("in_retry");
      expect(await db.commission.count()).toBe(0);
      expect(await db.referredSubscription.count()).toBe(0);

      // The retry, once Stripe answers.
      await handleCheckoutSessionCompleted(merchant, session);
      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.amount.toString()).toBe("10");
      const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
      expect(referred.firstPaymentRef).toBe("in_retry");
    });

    it("writes nothing and fails the event so it retries while the invoice is not paid yet", async () => {
      const session = sessionFixture({ invoice: "in_open", subscription: "sub_1", invoiceStatus: "open", amountPaid: 0 });

      await expect(handleCheckoutSessionCompleted(merchant, session)).rejects.toThrow("in_open");
      expect(await db.commission.count()).toBe(0);
      expect(await db.referredSubscription.count()).toBe(0);
    });

    it("reads no invoice for a free trial", async () => {
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ invoice: "in_trial", paymentStatus: "no_payment_required", subscription: "sub_1" })
      );
      await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_trial_zero", amountTotal: 0, subscription: "sub_2" }));

      expect(stripeStub.invoices.retrieve).not.toHaveBeenCalled();
    });

    it("earns nothing, logs once, and claims nothing on a paid subscription Session that names no invoice", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: null, subscription: "sub_no_invoice" }));
        expect(errors).toHaveBeenCalledTimes(1);
      } finally {
        errors.mockRestore();
      }

      expect(await db.commission.count()).toBe(0);
      const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_no_invoice" } });
      expect(referred.firstPaymentRef).toBeNull();
    });
  });

  describe("a one-time purchase's tax", () => {
    it("reads the Session back with its tax breakdown, customer and invoice", async () => {
      await handleCheckoutSessionCompleted(merchant, sessionFixture({ mode: "payment", paymentIntent: "pi_once" }));

      expect(stripeStub.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_pi_once", {
        expand: ["total_details.breakdown", "customer", "invoice"],
      });
    });

    it("earns on the price before tax when the tax inside it is only in the breakdown", async () => {
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({
          mode: "payment",
          paymentIntent: "pi_inclusive",
          amountTotal: 12000,
          tax: 0,
          currency: "eur",
          breakdownTaxes: [{ amount: 2000, rate: { inclusive: true } }],
        })
      );

      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.saleAmount?.toString()).toBe("100");
      expect(commission.amount.toString()).toBe("20");
      expect(commission.referredChargeMinor).toBeNull();
    });

    it("fails the event so it retries when the key cannot read the Session, and earns once it is replaced", async () => {
      stripeStub.checkout.sessions.retrieve.mockRejectedValueOnce(
        Object.assign(new Error("The provided key does not have the required permissions"), {
          type: "StripePermissionError",
          statusCode: 403,
        })
      );

      await expect(
        handleCheckoutSessionCompleted(merchant, sessionFixture({ mode: "payment", paymentIntent: "pi_old_key" }))
      ).rejects.toThrow(/required permissions/);
      expect(await db.commission.count()).toBe(0);

      // The retry, once the key is replaced, reads the Session and earns as usual.
      await handleCheckoutSessionCompleted(merchant, sessionFixture({ mode: "payment", paymentIntent: "pi_old_key" }));
      expect(await db.commission.count()).toBe(1);
    });

    it("fails the event so it retries when Stripe cannot be reached for the Session", async () => {
      stripeStub.checkout.sessions.retrieve.mockRejectedValueOnce(
        Object.assign(new Error("connection reset"), { type: "StripeConnectionError" })
      );

      await expect(
        handleCheckoutSessionCompleted(merchant, sessionFixture({ mode: "payment", paymentIntent: "pi_outage" }))
      ).rejects.toThrow("connection reset");
      expect(await db.commission.count()).toBe(0);
    });

    it("earns nothing, and logs once, when the Session no longer exists on Stripe", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      stripeStub.checkout.sessions.retrieve.mockRejectedValueOnce(
        Object.assign(new Error("No such checkout.session: cs_pi_deleted"), {
          type: "StripeInvalidRequestError",
          code: "resource_missing",
        })
      );
      try {
        await expect(
          handleCheckoutSessionCompleted(merchant, sessionFixture({ mode: "payment", paymentIntent: "pi_deleted" }))
        ).resolves.toBeUndefined();
        expect(errors).toHaveBeenCalledTimes(1);
        expect(errors.mock.calls[0][0]).toContain("cs_pi_deleted");
      } finally {
        errors.mockRestore();
      }
      expect(await db.commission.count()).toBe(0);
    });

    it("earns nothing, and logs once, when the Session comes back without a breakdown", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await handleCheckoutSessionCompleted(
          merchant,
          sessionFixture({ mode: "payment", paymentIntent: "pi_no_breakdown", breakdown: null })
        );
        expect(errors).toHaveBeenCalledTimes(1);
      } finally {
        errors.mockRestore();
      }
      expect(await db.commission.count()).toBe(0);
    });

    it("excludes on the customer carried by the Session read, without another call", async () => {
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ mode: "payment", paymentIntent: "pi_excluded", customerMetadata: { supaffi: "false" } })
      );

      expect(await db.commission.count()).toBe(0);
      expect(stripeStub.customers.retrieve).not.toHaveBeenCalled();
    });

    it("reads no Session for a zero-rate affiliate", async () => {
      await db.program.updateMany({ where: { merchantId: merchant.id }, data: { defaultCommissionRate: 0 } });

      await handleCheckoutSessionCompleted(merchant, sessionFixture({ mode: "payment", paymentIntent: "pi_zero_rate" }));

      expect(await db.commission.count()).toBe(0);
      expect(stripeStub.checkout.sessions.retrieve).not.toHaveBeenCalled();
    });

    it("earns on the price before tax and shipping, taking the full shipping cost off even when that double-counts its tax", async () => {
      // 101.00 goods with 20.00 exclusive tax on top, plus 10.00 shipping with
      // 1.00 tax already inside it (11.00 shipping_cost.amount_total, 21.00
      // total_details.amount_tax across both). The shipping tax is removed
      // twice (once inside the 21.00 tax figure, once via the full shipping
      // cost), leaving 100.00: 101.00 goods less the 1.00 shipping tax.
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({
          mode: "payment",
          paymentIntent: "pi_shipping",
          amountTotal: 13200,
          tax: 2100,
          shippingCost: { amount_subtotal: 1000, amount_tax: 100, amount_total: 1100 },
        })
      );

      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.saleAmount?.toString()).toBe("100");
      expect(commission.amount.toString()).toBe("20");
    });
  });

  describe("the payment reference a sale is stored under", () => {
    it("stores a one-time purchase with a post-purchase invoice under its PaymentIntent", async () => {
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ mode: "payment", paymentIntent: "pi_post", invoice: "in_post" })
      );

      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.stripePaymentRef).toBe("pi_post");
      expect(stripeStub.invoices.retrieve).not.toHaveBeenCalled();
      expect(stripeStub.invoicePayments.list).not.toHaveBeenCalled();
    });

    it("stores a one-time purchase without a post-purchase invoice under its PaymentIntent, as before", async () => {
      await handleCheckoutSessionCompleted(merchant, sessionFixture({ mode: "payment", paymentIntent: "pi_plain" }));

      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.stripePaymentRef).toBe("pi_plain");
    });

    it("keeps storing a subscription's first payment under its invoice", async () => {
      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ invoice: "in_sub_first", paymentIntent: "pi_sub_first", subscription: "sub_1" })
      );

      const commission = await db.commission.findFirstOrThrow({ where: { clickId: click.id } });
      expect(commission.stripePaymentRef).toBe("in_sub_first");
      const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
      expect(referred.firstPaymentRef).toBe("in_sub_first");
    });

    it("writes one row when a delayed one-time payment completes and then settles", async () => {
      const session = sessionFixture({ mode: "payment", paymentIntent: "pi_delayed", invoice: "in_delayed" });
      await handleCheckoutSessionCompleted(merchant, { ...session, payment_status: "unpaid" });
      await handleCheckoutSessionCompleted(merchant, session);
      await handleCheckoutSessionCompleted(merchant, session);

      const commissions = await db.commission.findMany({ where: { clickId: click.id } });
      expect(commissions.map((c) => c.stripePaymentRef)).toEqual(["pi_delayed"]);
    });

    it("does not write a second row for a sale stored under its post-purchase invoice before 0.2.7", async () => {
      // Written by the earlier key choice. A redelivered event, or a lease
      // reclaimed after the upgrade, now computes the PaymentIntent instead.
      await db.commission.create({
        data: {
          affiliateId: clickInput.affiliateId,
          clickId: click.id,
          stripePaymentRef: "in_before",
          amount: 10,
          grossAmount: 10,
          currency: "usd",
          saleAmount: 50,
          status: "PENDING",
          payableAt: new Date(),
        },
      });

      await handleCheckoutSessionCompleted(
        merchant,
        sessionFixture({ mode: "payment", paymentIntent: "pi_before", invoice: "in_before" })
      );

      const commissions = await db.commission.findMany({ where: { clickId: click.id } });
      expect(commissions.map((c) => c.stripePaymentRef)).toEqual(["in_before"]);
      // Ends where a dedupe would, before any Stripe call.
      expect(stripeStub.checkout.sessions.retrieve).not.toHaveBeenCalled();
      expect(stripeStub.customers.retrieve).not.toHaveBeenCalled();
      expect(stripeStub.paymentIntents.retrieve).not.toHaveBeenCalled();
    });
  });
});
