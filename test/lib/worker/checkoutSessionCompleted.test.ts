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
const stripeStub = vi.hoisted(() => ({
  customers: {
    retrieve: vi.fn(async () => ({ id: "cus_test", metadata: {} })),
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

  function sessionFixture(opts: { invoice: string; metadataToken?: string }): Stripe.Checkout.Session {
    return {
      id: `cs_${opts.invoice}`,
      mode: "subscription",
      created: Math.floor(Date.now() / 1000),
      metadata: { [REFERRAL_METADATA_KEY]: opts.metadataToken ?? clickInput.referralToken },
      customer: CUSTOMER_ID,
      customer_details: { email: "buyer@example.com" },
      amount_total: 5000,
      currency: "usd",
      invoice: opts.invoice,
      payment_intent: null,
      subscription: null,
    } as unknown as Stripe.Checkout.Session;
  }

  beforeEach(async () => {
    await clearAll();
    stripeStub.customers.retrieve.mockClear();

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
});
