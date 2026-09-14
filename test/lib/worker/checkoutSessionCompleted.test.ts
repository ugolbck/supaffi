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
      subscription: opts.subscription ?? null,
    } as unknown as Stripe.Checkout.Session;
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

      const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
      expect(referred.stripeProductIds).toEqual([]);
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
    stripeStub.customers.retrieve.mockResolvedValueOnce({ id: "cus_test", metadata: { supaffi: "false" } } as never);

    await handleCheckoutSessionCompleted(merchant, sessionFixture({ invoice: "in_first", subscription: "sub_1" }));

    expect(await db.commission.count()).toBe(0);
    const referred = await db.referredSubscription.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_1" } });
    expect(referred.firstPaymentRef).toBe("in_first");
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
});
