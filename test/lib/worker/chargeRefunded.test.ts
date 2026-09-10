// Destructive: clears Commission / Click / AffiliateLink / Affiliate / Program /
// Merchant / Owner. Runs against the scratch DATABASE_URL that test/setup.ts
// enforces, never the dev one.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import type { Commission, Merchant } from "@prisma/client";
import type Stripe from "stripe";

import { db } from "@/lib/db";

// The handler resolves a Stripe client for the Merchant and asks it to trace
// the Charge back to an Invoice. These fixtures are one-time purchases with no
// Invoice at all, so the lookup finds nothing and the handler falls back to the
// PaymentIntent ID, which is what Commission.stripePaymentRef holds for them.
const stripeStub = vi.hoisted(() => ({
  invoicePayments: {
    list: vi.fn(async () => ({ data: [] })),
  },
}));
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe")>("@/lib/stripe");
  return { ...actual, stripeClientFor: () => stripeStub as unknown as Stripe };
});

import { handleChargeRefunded, prorateCommission } from "@/lib/worker/handlers/chargeRefunded";

describe("prorateCommission", () => {
  it("voids when the whole sale came back", () => {
    expect(prorateCommission({ gross: 15.6, chargeTotal: 7800, refunded: 7800 })).toEqual({
      void: true,
    });
  });

  it("takes the same fraction off the commission as came off the sale", () => {
    // Half the sale refunded, half the commission survives.
    expect(prorateCommission({ gross: 15.6, chargeTotal: 7800, refunded: 3900 })).toEqual({
      void: false,
      amount: 7.8,
    });
  });

  it("prorates against the original, so a second partial refund does not compound", () => {
    const first = prorateCommission({ gross: 15.6, chargeTotal: 7800, refunded: 1950 });
    const second = prorateCommission({ gross: 15.6, chargeTotal: 7800, refunded: 3900 });
    expect(first).toEqual({ void: false, amount: 11.7 });
    expect(second).toEqual({ void: false, amount: 7.8 });
  });

  it("voids rather than leaving a zero row when rounding wipes it out", () => {
    expect(prorateCommission({ gross: 0.02, chargeTotal: 10000, refunded: 9999 })).toEqual({
      void: true,
    });
  });
});

const PAYMENT_INTENT_ID = "pi_refund_test";

async function clearAll() {
  await db.commission.deleteMany({ where: { adjustsCommissionId: { not: null } } });
  await db.commission.deleteMany();
  await db.click.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

describe("handleChargeRefunded", () => {
  let merchant: Merchant;
  let clickId: string;
  let affiliateId: string;

  // A seventy eight dollar sale earning a fifteen sixty commission, so the
  // fractions in these cases land on exact cents.
  function chargeFixture(refunded: number): Stripe.Charge {
    return {
      id: "ch_refund_test",
      amount: 7800,
      amount_refunded: refunded,
      currency: "usd",
      payment_intent: PAYMENT_INTENT_ID,
    } as unknown as Stripe.Charge;
  }

  async function givenCommission(overrides: Partial<Commission> = {}): Promise<Commission> {
    return db.commission.create({
      data: {
        affiliateId,
        clickId,
        stripePaymentRef: PAYMENT_INTENT_ID,
        amount: 15.6,
        grossAmount: 15.6,
        currency: "usd",
        saleAmount: 78,
        status: "PENDING",
        payableAt: new Date(),
        ...overrides,
      },
    });
  }

  function adjustmentsOf(commission: Commission) {
    return db.commission.findMany({
      where: { adjustsCommissionId: commission.id },
      orderBy: { createdAt: "asc" },
    });
  }

  beforeEach(async () => {
    await clearAll();
    stripeStub.invoicePayments.list.mockClear();

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
    affiliateId = affiliate.id;
    const click = await db.click.create({
      data: {
        affiliateId: affiliate.id,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    clickId = click.id;
  });

  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("reduces an unpaid commission by the refunded fraction instead of voiding it", async () => {
    // A goodwill refund of half the sale. The affiliate keeps half, not nothing.
    const commission = await givenCommission();
    await handleChargeRefunded(merchant, chargeFixture(3900));

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.amount.toString()).toBe("7.8");
    expect(updated.status).toBe("PENDING");
    expect(updated.voidReason).toBe("partial refund");
    expect(updated.voidedAt).toBeNull();
  });

  it("leaves a flagged commission flagged, with its reason intact", async () => {
    const commission = await givenCommission({
      status: "FLAGGED",
      flagReason: "card",
    });
    await handleChargeRefunded(merchant, chargeFixture(3900));

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("FLAGGED");
    expect(updated.flagReason).toBe("card");
    expect(updated.amount.toString()).toBe("7.8");
    expect(updated.voidReason).toBe("partial refund");
  });

  it("voids when the whole sale came back", async () => {
    const commission = await givenCommission();
    await handleChargeRefunded(merchant, chargeFixture(7800));

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("VOIDED");
    expect(updated.voidReason).toBe("refund");
    expect(updated.voidedAt).not.toBeNull();
  });

  it("claws back only the refunded portion of a commission already paid", async () => {
    const commission = await givenCommission({ status: "PAID", paidAt: new Date() });
    await handleChargeRefunded(merchant, chargeFixture(3900));

    const adjustments = await adjustmentsOf(commission);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].amount.toString()).toBe("-7.8");
    expect(adjustments[0].status).toBe("PAYABLE");

    // The paid row itself is never rewritten.
    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("PAID");
    expect(updated.amount.toString()).toBe("15.6");
  });

  it("adds only the difference when a second refund raises the cumulative total", async () => {
    const commission = await givenCommission({ status: "PAID", paidAt: new Date() });
    await handleChargeRefunded(merchant, chargeFixture(3900)); // half back, claws 7.80
    await handleChargeRefunded(merchant, chargeFixture(5850)); // now 75% back, owes 11.70

    const adjustments = await adjustmentsOf(commission);
    expect(adjustments.map((row) => row.amount.toString())).toEqual(["-7.8", "-3.9"]);
  });

  it("adds nothing on a redelivery of the same refund", async () => {
    const commission = await givenCommission({ status: "PAID", paidAt: new Date() });
    await handleChargeRefunded(merchant, chargeFixture(3900));
    await handleChargeRefunded(merchant, chargeFixture(3900));

    const adjustments = await adjustmentsOf(commission);
    expect(adjustments).toHaveLength(1);
  });

  it("claws back what the affiliate was paid, not the gross, on a commission reduced before payout", async () => {
    // Half the sale came back while the commission was still pending, so it was
    // paid out at 7.80. A later refund taking the total to 75% must not charge
    // back more than the 7.80 that ever left the merchant's hands.
    const commission = await givenCommission({
      status: "PAID",
      paidAt: new Date(),
      amount: new Prisma.Decimal(7.8),
      grossAmount: new Prisma.Decimal(15.6),
      voidReason: "partial refund",
    });
    await handleChargeRefunded(merchant, chargeFixture(5850));

    const adjustments = await adjustmentsOf(commission);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].amount.toString()).toBe("-3.9");
  });

  it("does nothing when the charge traces to no commission", async () => {
    await givenCommission({ stripePaymentRef: "pi_somebody_else" });
    await handleChargeRefunded(merchant, chargeFixture(7800));

    const voided = await db.commission.findMany({ where: { status: "VOIDED" } });
    expect(voided).toHaveLength(0);
  });
});
