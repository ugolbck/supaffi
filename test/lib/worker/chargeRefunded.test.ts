// Destructive: clears Commission / Click / AffiliateLink / Affiliate / Program /
// Merchant / Owner. Runs against the scratch DATABASE_URL that test/setup.ts
// enforces, never the dev one.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import type { Commission, Merchant } from "@prisma/client";
import type Stripe from "stripe";

import { db } from "@/lib/db";
import { getAffiliateMetrics } from "@/lib/analytics";

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
import { handleChargeDisputeClosed } from "@/lib/worker/handlers/chargeDisputeClosed";

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

  it("prorates a tax-inclusive charge against the pre-tax commission without adjustment", () => {
    // 120.00 EUR charged, 20.00 of it VAT, commission 20.00 on the 100.00 base.
    // Refunding 60.00 returns half the goods and half the VAT, so half the
    // commission goes: the ratio is the same with or without the tax in it.
    expect(prorateCommission({ gross: 20, chargeTotal: 12000, refunded: 6000 })).toEqual({
      void: false,
      amount: 10,
    });
  });

  // 200.00 charge of 100.00 referred plan plus 100.00 of a non-referred add-on,
  // commission 30.00 on the 100.00 referred base.
  describe("when the row records the referred share of the charge", () => {
    it("voids on a refund of exactly the referred share, even though most of the charge remains", () => {
      expect(
        prorateCommission({ gross: 30, chargeTotal: 20000, refunded: 10000, referredChargeMinor: 10000 })
      ).toEqual({ void: true });
    });

    it("keeps half the commission when half the referred share is refunded", () => {
      expect(
        prorateCommission({ gross: 30, chargeTotal: 20000, refunded: 5000, referredChargeMinor: 10000 })
      ).toEqual({ void: false, amount: 15 });
    });

    it("takes the referred share out of the refund first, so refunding the whole charge still leaves nothing beyond the referred voiding", () => {
      expect(
        prorateCommission({ gross: 30, chargeTotal: 20000, refunded: 20000, referredChargeMinor: 10000 })
      ).toEqual({ void: true });
    });

    it("behaves exactly as before when the row has no referred share recorded", () => {
      // Same charge and refund as the merchant-safe void case above, but
      // without referredChargeMinor: prorates against the whole charge, the
      // rule every row used before this existed.
      expect(prorateCommission({ gross: 30, chargeTotal: 20000, refunded: 10000 })).toEqual({
        void: false,
        amount: 15,
      });
    });
  });
});

const PAYMENT_INTENT_ID = "pi_refund_test";

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

  it("leaves a paid commission, and what the affiliate earned and was paid, untouched by a later refund", async () => {
    // A paid commission is final: the merchant absorbs a refund after payout.
    const commission = await givenCommission({ status: "PAID", paidAt: new Date() });
    const before = await getAffiliateMetrics(affiliateId, 30);

    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await handleChargeRefunded(merchant, chargeFixture(3900));
      await handleChargeRefunded(merchant, chargeFixture(7800));
      expect(log).toHaveBeenCalledTimes(2);
      expect(String(log.mock.calls[0][0])).toContain(commission.id);
    } finally {
      log.mockRestore();
    }

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("PAID");
    expect(updated.amount.toString()).toBe("15.6");
    expect(updated.voidReason).toBeNull();
    expect(await adjustmentsOf(commission)).toHaveLength(0);

    const after = await getAffiliateMetrics(affiliateId, 30);
    expect(after.paid).toEqual(before.paid);
    expect(after.unpaid).toEqual(before.unpaid);
    expect(after.payable).toEqual(before.payable);
    expect(after.current.amounts).toEqual(before.current.amounts);
  });

  it("voids a commission recorded against only the referred share of the charge once that share alone is refunded", async () => {
    // The 78.00 charge here stands in for a 100.00 referred plan next to a
    // non-referred add-on; only 39.00 of it (half) is ever recorded as
    // referred, in the same units chargeFixture already uses.
    const commission = await givenCommission({ referredChargeMinor: 3900 });
    await handleChargeRefunded(merchant, chargeFixture(3900));

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("VOIDED");
    expect(updated.voidReason).toBe("refund");
  });

  it("keeps most of the commission when a refund smaller than the referred share lands", async () => {
    const commission = await givenCommission({ referredChargeMinor: 3900 });
    await handleChargeRefunded(merchant, chargeFixture(1950));

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.amount.toString()).toBe("7.8");
    expect(updated.status).toBe("PENDING");
  });

  it("does nothing when the charge traces to no commission", async () => {
    await givenCommission({ stripePaymentRef: "pi_somebody_else" });
    await handleChargeRefunded(merchant, chargeFixture(7800));

    const voided = await db.commission.findMany({ where: { status: "VOIDED" } });
    expect(voided).toHaveLength(0);
  });

  it("never raises a commission when an older refund event arrives after a newer one", async () => {
    // Stripe does not guarantee order. 75% refunded lands first, then the
    // earlier 25% snapshot; the commission must stay at the lower figure.
    const commission = await givenCommission();
    await handleChargeRefunded(merchant, chargeFixture(5850));
    await handleChargeRefunded(merchant, chargeFixture(1950));

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.amount.toString()).toBe("3.9");
  });

  it("ignores a commission that belongs to a different Merchant", async () => {
    const commission = await givenCommission();
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
    await handleChargeRefunded(other, chargeFixture(7800));

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("PENDING");
  });

  it("changes nothing when the commission is paid out between the read and the write", async () => {
    const commission = await givenCommission();
    const realUpdateMany = db.commission.updateMany.bind(db.commission);
    const spy = vi.spyOn(db.commission, "updateMany").mockImplementationOnce((async (args: Prisma.CommissionUpdateManyArgs) => {
      await db.commission.update({ where: { id: commission.id }, data: { status: "PAID", paidAt: new Date() } });
      return realUpdateMany(args);
    }) as unknown as typeof db.commission.updateMany);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await handleChargeRefunded(merchant, chargeFixture(7800));
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("PAID");
    expect(updated.amount.toString()).toBe("15.6");
    expect(updated.voidedAt).toBeNull();
    expect(await adjustmentsOf(commission)).toHaveLength(0);
  });

  function disputeFixture(status: string): Stripe.Dispute {
    return {
      id: "dp_test",
      status,
      charge: "ch_refund_test",
      payment_intent: PAYMENT_INTENT_ID,
    } as unknown as Stripe.Dispute;
  }

  it("voids an unpaid commission when a chargeback is lost", async () => {
    const commission = await givenCommission();
    await handleChargeDisputeClosed(merchant, disputeFixture("lost"));

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("VOIDED");
    expect(updated.voidReason).toBe("chargeback");
  });

  it("changes nothing on a paid commission when a chargeback is lost", async () => {
    const commission = await givenCommission({ status: "PAID", paidAt: new Date() });
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await handleChargeDisputeClosed(merchant, disputeFixture("lost"));
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("PAID");
    expect(updated.amount.toString()).toBe("15.6");
    expect(updated.voidReason).toBeNull();
    expect(await adjustmentsOf(commission)).toHaveLength(0);
  });
});
