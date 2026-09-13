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
  },
  invoicePayments: {
    list: vi.fn(async (): Promise<{ data: unknown[] }> => ({ data: [] })),
  },
  paymentIntents: {
    retrieve: vi.fn(async (): Promise<unknown> => ({ id: "pi_renewal", latest_charge: null })),
  },
}));
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe")>("@/lib/stripe");
  return { ...actual, stripeClientFor: () => stripeStub as unknown as Stripe };
});

import { handleInvoicePaid } from "@/lib/worker/handlers/invoicePaid";

const CUSTOMER_ID = "cus_renewal";

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
      parent: null,
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
        stripeCustomerId: CUSTOMER_ID,
      },
    });
    clickId = click.id;
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
});
