// Destructive: clears Commission / Click / AffiliateLink / Affiliate / Program /
// Merchant / Owner. Runs against the scratch DATABASE_URL that test/setup.ts
// enforces, never the dev one.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";

import { db } from "@/lib/db";

// The handler resolves a Stripe client for the Merchant and asks it whether
// the Customer carries the exclusion flag. Only that one call is reachable
// here, so the stub answers it and nothing touches the network. The rest of
// the module (minorUnitsToMajor, used by the commission maths) stays real.
// The handler also looks up the charge behind the payment, to fold in a
// refund made before the commission existed. By default the invoice has no
// payment on record, so that lookup finds nothing and changes nothing.
const stripeStub = vi.hoisted(() => ({
  customers: {
    retrieve: vi.fn(async () => ({ id: "cus_test", metadata: {} })),
  },
  invoicePayments: {
    list: vi.fn(async (): Promise<{ data: unknown[] }> => ({ data: [] })),
  },
  paymentIntents: {
    retrieve: vi.fn(async (): Promise<unknown> => ({ id: "pi_test", latest_charge: null })),
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

const CUSTOMER_ID = "cus_test";

async function clearAll() {
  await db.commission.deleteMany();
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
  }): Stripe.Checkout.Session {
    return {
      id: `cs_${opts.invoice ?? opts.paymentIntent}`,
      mode: opts.mode ?? "subscription",
      payment_status: opts.paymentStatus ?? "paid",
      created: Math.floor(Date.now() / 1000),
      metadata: { [REFERRAL_METADATA_KEY]: opts.metadataToken ?? clickInput.referralToken },
      customer: CUSTOMER_ID,
      customer_details: { email: "buyer@example.com" },
      amount_total: opts.amountTotal ?? 5000,
      total_details:
        opts.totalDetails === null
          ? null
          : { amount_discount: 0, amount_shipping: opts.shippingCost?.amount_subtotal ?? 0, amount_tax: opts.tax ?? 0 },
      shipping_cost: opts.shippingCost ?? null,
      currency: opts.currency ?? "usd",
      invoice: opts.invoice ?? null,
      payment_intent: opts.paymentIntent ?? null,
      subscription: null,
    } as unknown as Stripe.Checkout.Session;
  }

  beforeEach(async () => {
    await clearAll();
    stripeStub.customers.retrieve.mockClear();
    stripeStub.invoicePayments.list.mockReset();
    stripeStub.invoicePayments.list.mockImplementation(async () => ({ data: [] }));
    stripeStub.paymentIntents.retrieve.mockReset();
    stripeStub.paymentIntents.retrieve.mockImplementation(async () => ({ id: "pi_test", latest_charge: null }));

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

  it("leaves the customer attached to the click that first brought them", async () => {
    await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_first" }));
    const second = await db.click.create({ data: { ...clickInput, referralToken: "tok-2" } });
    await handleCheckoutSessionCompleted(
      merchant,
      sessionFixture({ invoice: "in_second", metadataToken: "tok-2" })
    );

    const refreshed = await db.click.findUnique({ where: { id: second.id } });
    expect(refreshed?.stripeCustomerId).toBeNull();
  });

  it("waits for a delayed payment to settle before creating anything", async () => {
    // SEPA and ACH complete the Session unpaid; the async success event brings
    // the same Session back paid.
    await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_first", paymentStatus: "unpaid" }));
    expect(await db.commission.count()).toBe(0);
    expect((await db.click.findUniqueOrThrow({ where: { id: click.id } })).stripeCustomerId).toBeNull();

    await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_first" }));
    expect(await db.commission.count()).toBe(1);
  });

  it("links a free trial's customer but creates no commission on it", async () => {
    await handleCheckoutSessionCompleted(
      merchant,
      sessionFixture({ invoice: "in_trial", paymentStatus: "no_payment_required" })
    );
    expect(await db.commission.count()).toBe(0);
    expect((await db.click.findUniqueOrThrow({ where: { id: click.id } })).stripeCustomerId).toBe(CUSTOMER_ID);
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
});
