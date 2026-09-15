// Destructive: clears Commission / ReferredSubscription / Click / AffiliateLink /
// Affiliate / Program / Merchant / Owner. Runs against the scratch DATABASE_URL
// that test/setup.ts enforces, never the dev one.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { inspect } from "node:util";
import type { Commission, Merchant } from "@prisma/client";
import type Stripe from "stripe";

import { db } from "@/lib/db";

// Every Stripe call a dispute handler can make. The fixtures are one-time
// purchases with no Invoice, so the invoice lookup finds nothing and the
// PaymentIntent id is the commission's payment reference.
const stripeStub = vi.hoisted(() => ({
  invoicePayments: {
    list: vi.fn(async (_params: unknown): Promise<{ data: unknown[] }> => ({ data: [] })),
  },
  disputes: {
    list: vi.fn(
      async (
        _params: unknown
      ): Promise<{
        data: Array<{ id: string; status: string; payment_method_details?: { card?: { case_type?: string } } }>;
      }> => ({ data: [] })
    ),
  },
  charges: {
    retrieve: vi.fn(async (_id: string): Promise<unknown> => undefined),
  },
}));
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe")>("@/lib/stripe");
  return { ...actual, stripeClientFor: () => stripeStub as unknown as Stripe };
});

import { handleChargeDisputeCreated } from "@/lib/worker/handlers/chargeDisputeCreated";
import { handleChargeDisputeClosed } from "@/lib/worker/handlers/chargeDisputeClosed";
import { disputeStateFor, disputeStateOf } from "@/lib/worker/disputes";
import { sweepPayableCommissions } from "@/lib/worker/sweep";

const PAYMENT_INTENT_ID = "pi_dispute_test";
const DAY = 24 * 60 * 60 * 1000;

describe("disputeStateOf", () => {
  it("reads no disputes, or only ones settled for the merchant, as clear", () => {
    expect(disputeStateOf([])).toBe("clear");
    expect(
      disputeStateOf([
        { status: "won" },
        { status: "warning_closed" },
        { status: "prevented", payment_method_details: { card: { case_type: "block" } } },
      ])
    ).toBe("clear");
  });

  it("reads any dispute still in progress as open, including a status it does not know", () => {
    for (const status of ["warning_needs_response", "warning_under_review", "needs_response", "under_review", "something_new"]) {
      expect(disputeStateOf([{ status: "won" }, { status }])).toBe("open");
    }
  });

  it("reads a lost dispute as lost, whatever else is on the charge", () => {
    expect(disputeStateOf([{ status: "needs_response" }, { status: "lost" }])).toBe("lost");
  });

  it("reads a prevented dispute that blocked the chargeback as clear", () => {
    expect(disputeStateOf([{ status: "prevented", payment_method_details: { card: { case_type: "block" } } }])).toBe(
      "clear"
    );
  });

  it("reads a prevented dispute that refunded the cardholder as lost", () => {
    expect(
      disputeStateOf([{ status: "prevented", payment_method_details: { card: { case_type: "resolution" } } }])
    ).toBe("lost");
  });

  it("reads a prevented dispute with no case type, or an unrecognised one, as lost", () => {
    expect(disputeStateOf([{ status: "prevented" }])).toBe("lost");
    expect(disputeStateOf([{ status: "prevented", payment_method_details: {} }])).toBe("lost");
    expect(disputeStateOf([{ status: "prevented", payment_method_details: { card: {} } }])).toBe("lost");
    expect(
      disputeStateOf([{ status: "prevented", payment_method_details: { card: { case_type: "compliance" } } }])
    ).toBe("lost");
  });
});

describe("disputeStateFor", () => {
  it("lists the disputes on the payment", async () => {
    const list = vi.fn(async () => ({ data: [{ id: "dp_1", status: "under_review" }] }));
    const stripe = { disputes: { list } } as unknown as Stripe;

    expect(await disputeStateFor(stripe, "pi_1")).toBe("open");
    expect(list).toHaveBeenCalledWith({ payment_intent: "pi_1", limit: 100 });
  });

  it("answers unknown, and logs one line, when the disputes cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stripe = {
      disputes: { list: vi.fn(async () => { throw Object.assign(new Error("permission"), { type: "StripePermissionError" }); }) },
    } as unknown as Stripe;
    try {
      expect(await disputeStateFor(stripe, "pi_1")).toBe("unknown");
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("logs only the Stripe error's type and code, never its raw message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stripe = {
      disputes: {
        list: vi.fn(async () => {
          // A permission error's raw message names the masked key and the
          // account; it must never reach the server log.
          throw Object.assign(
            new Error("The provided key does not have the required permissions on account acct_secret123"),
            { type: "StripePermissionError", code: "permission_error" }
          );
        }),
      },
    } as unknown as Stripe;
    try {
      expect(await disputeStateFor(stripe, "pi_1")).toBe("unknown");
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = warn.mock.calls[0][0] as string;
      expect(logged).toMatch(/StripePermissionError\/permission_error/);
      expect(logged).not.toMatch(/acct_secret123|required permissions/);
      expect(inspect(warn.mock.calls[0])).not.toContain("acct_secret123");
    } finally {
      warn.mockRestore();
    }
  });
});

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

describe("dispute handlers", () => {
  let merchant: Merchant;
  let affiliateId: string;
  let clickId: string;

  function dispute(
    status: string,
    overrides: { payment_intent?: string | null; case_type?: string } = {}
  ): Stripe.Dispute {
    const { case_type, ...rest } = overrides;
    return {
      id: "dp_1",
      status,
      charge: "ch_dispute_test",
      payment_intent: PAYMENT_INTENT_ID,
      ...(case_type ? { payment_method_details: { card: { case_type } } } : {}),
      ...rest,
    } as unknown as Stripe.Dispute;
  }

  /**
   * What Stripe answers, now, for the disputes on the test payment. Each entry
   * is a status, or a status paired with a "prevented" dispute's case type.
   */
  function disputesOnCharge(...entries: (string | { status: string; case_type?: string })[]) {
    stripeStub.disputes.list.mockImplementation(async () => ({
      data: entries.map((entry, index) => {
        const { status, case_type } = typeof entry === "string" ? { status: entry, case_type: undefined } : entry;
        return {
          id: `dp_${index + 1}`,
          status,
          ...(case_type ? { payment_method_details: { card: { case_type } } } : {}),
        };
      }),
    }));
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
        payableAt: new Date(Date.now() + 10 * DAY),
        ...overrides,
      },
    });
  }

  function reload(commission: Commission) {
    return db.commission.findUniqueOrThrow({ where: { id: commission.id } });
  }

  beforeEach(async () => {
    await clearAll();
    stripeStub.invoicePayments.list.mockReset();
    stripeStub.invoicePayments.list.mockImplementation(async () => ({ data: [] }));
    stripeStub.disputes.list.mockReset();
    stripeStub.disputes.list.mockImplementation(async () => ({ data: [] }));
    stripeStub.charges.retrieve.mockReset();

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
      data: { affiliateId, referralToken: crypto.randomUUID(), expiresAt: new Date(Date.now() + DAY) },
    });
    clickId = click.id;
  });

  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("holds a commission when a dispute opens inside the hold, keeps it through the sweep, and releases it when won", async () => {
    const commission = await givenCommission();
    disputesOnCharge("needs_response");

    await handleChargeDisputeCreated(merchant, dispute("needs_response"));
    const held = await reload(commission);
    expect(held.status).toBe("PENDING");
    expect(held.disputeOpenedAt).not.toBeNull();
    expect(stripeStub.disputes.list).toHaveBeenCalledWith({ payment_intent: PAYMENT_INTENT_ID, limit: 100 });

    // The holding period ends while the bank is still deciding.
    await db.commission.update({ where: { id: commission.id }, data: { payableAt: new Date(Date.now() - DAY) } });
    await sweepPayableCommissions();
    expect((await reload(commission)).status).toBe("PENDING");

    disputesOnCharge("won");
    await handleChargeDisputeClosed(merchant, dispute("won"));
    const released = await reload(commission);
    expect(released.status).toBe("PAYABLE");
    expect(released.disputeOpenedAt).toBeNull();
  });

  it("releases a commission still inside its hold to pending when an inquiry closes without a chargeback", async () => {
    const commission = await givenCommission();
    disputesOnCharge("warning_needs_response");
    await handleChargeDisputeCreated(merchant, dispute("warning_needs_response"));

    disputesOnCharge("warning_closed");
    await handleChargeDisputeClosed(merchant, dispute("warning_closed"));

    const released = await reload(commission);
    expect(released.status).toBe("PENDING");
    expect(released.disputeOpenedAt).toBeNull();
  });

  it("voids a held commission when the dispute is lost", async () => {
    const commission = await givenCommission();
    disputesOnCharge("needs_response");
    await handleChargeDisputeCreated(merchant, dispute("needs_response"));

    await handleChargeDisputeClosed(merchant, dispute("lost"));

    const voided = await reload(commission);
    expect(voided.status).toBe("VOIDED");
    expect(voided.voidReason).toBe("chargeback");
  });

  it("releases a held commission when the dispute is prevented by a block", async () => {
    const commission = await givenCommission({ payableAt: new Date(Date.now() - DAY) });
    disputesOnCharge("needs_response");
    await handleChargeDisputeCreated(merchant, dispute("needs_response"));

    disputesOnCharge({ status: "prevented", case_type: "block" });
    await handleChargeDisputeClosed(merchant, dispute("prevented", { case_type: "block" }));

    const released = await reload(commission);
    expect(released.status).toBe("PAYABLE");
    expect(released.disputeOpenedAt).toBeNull();
  });

  it("voids an unpaid held commission when a prevented dispute refunded the cardholder instead of blocking the chargeback", async () => {
    const commission = await givenCommission();
    disputesOnCharge("needs_response");
    await handleChargeDisputeCreated(merchant, dispute("needs_response"));

    disputesOnCharge({ status: "prevented", case_type: "resolution" });
    await handleChargeDisputeClosed(merchant, dispute("prevented", { case_type: "resolution" }));

    const voided = await reload(commission);
    expect(voided.status).toBe("VOIDED");
    expect(voided.voidReason).toBe("chargeback");
  });

  it("voids an unpaid held commission when a prevented dispute carries no case type", async () => {
    const commission = await givenCommission();
    disputesOnCharge("needs_response");
    await handleChargeDisputeCreated(merchant, dispute("needs_response"));

    disputesOnCharge({ status: "prevented" });
    await handleChargeDisputeClosed(merchant, dispute("prevented"));

    const voided = await reload(commission);
    expect(voided.status).toBe("VOIDED");
    expect(voided.voidReason).toBe("chargeback");
  });

  it("changes nothing when a prevented dispute that refunded the cardholder closes on a commission already paid", async () => {
    const commission = await givenCommission({ status: "PAID", paidAt: new Date() });
    disputesOnCharge({ status: "prevented", case_type: "resolution" });

    await handleChargeDisputeClosed(merchant, dispute("prevented", { case_type: "resolution" }));

    const paid = await reload(commission);
    expect(paid.status).toBe("PAID");
    expect(stripeStub.disputes.list).not.toHaveBeenCalled();
  });

  it("takes a payable commission back to pending while the dispute is open", async () => {
    const commission = await givenCommission({ status: "PAYABLE", payableAt: new Date(Date.now() - DAY) });
    disputesOnCharge("needs_response");

    await handleChargeDisputeCreated(merchant, dispute("needs_response"));

    const held = await reload(commission);
    expect(held.status).toBe("PENDING");
    expect(held.disputeOpenedAt).not.toBeNull();
  });

  it("keeps a flagged commission flagged, with its reason, and holds it", async () => {
    const commission = await givenCommission({ status: "FLAGGED", flagReason: "card" });
    disputesOnCharge("needs_response");

    await handleChargeDisputeCreated(merchant, dispute("needs_response"));

    const held = await reload(commission);
    expect(held.status).toBe("FLAGGED");
    expect(held.flagReason).toBe("card");
    expect(held.disputeOpenedAt).not.toBeNull();
  });

  it("keeps the first date the hold began when the opening event is delivered again", async () => {
    const commission = await givenCommission();
    disputesOnCharge("needs_response");
    await handleChargeDisputeCreated(merchant, dispute("needs_response"));
    const first = (await reload(commission)).disputeOpenedAt;

    await handleChargeDisputeCreated(merchant, dispute("needs_response"));

    expect((await reload(commission)).disputeOpenedAt).toEqual(first);
  });

  it("changes nothing when a dispute opens on a commission already paid", async () => {
    const commission = await givenCommission({ status: "PAID", paidAt: new Date() });
    disputesOnCharge("needs_response");

    await handleChargeDisputeCreated(merchant, dispute("needs_response"));

    const paid = await reload(commission);
    expect(paid.status).toBe("PAID");
    expect(paid.disputeOpenedAt).toBeNull();
    expect(stripeStub.disputes.list).not.toHaveBeenCalled();
  });

  it("changes nothing on a voided commission", async () => {
    const commission = await givenCommission({ status: "VOIDED", voidedAt: new Date(), voidReason: "refund" });
    disputesOnCharge("needs_response");

    await handleChargeDisputeCreated(merchant, dispute("needs_response"));

    const voided = await reload(commission);
    expect(voided.status).toBe("VOIDED");
    expect(voided.disputeOpenedAt).toBeNull();
  });

  it("does nothing, and does not fail the event, when the sale has not been recorded yet", async () => {
    disputesOnCharge("needs_response");
    await expect(handleChargeDisputeCreated(merchant, dispute("needs_response"))).resolves.toBeUndefined();
    expect(await db.commission.count()).toBe(0);
  });

  it("holds nothing when the opening event arrives after the dispute was already won", async () => {
    // Stripe does not promise order: closed was processed first and found
    // nothing held, then the late opening event must not start a hold.
    const commission = await givenCommission();
    disputesOnCharge("won");
    await handleChargeDisputeClosed(merchant, dispute("won"));

    await handleChargeDisputeCreated(merchant, dispute("needs_response"));

    const row = await reload(commission);
    expect(row.status).toBe("PENDING");
    expect(row.disputeOpenedAt).toBeNull();
  });

  it("voids when the opening event arrives after the dispute was already lost", async () => {
    const commission = await givenCommission();
    disputesOnCharge("lost");

    await handleChargeDisputeCreated(merchant, dispute("needs_response"));

    const row = await reload(commission);
    expect(row.status).toBe("VOIDED");
    expect(row.voidReason).toBe("chargeback");
  });

  it("keeps the hold when one dispute is won while another on the same charge is still open", async () => {
    const commission = await givenCommission({ payableAt: new Date(Date.now() - DAY) });
    disputesOnCharge("needs_response");
    await handleChargeDisputeCreated(merchant, dispute("needs_response"));

    disputesOnCharge("won", "needs_response");
    await handleChargeDisputeClosed(merchant, dispute("won"));

    const row = await reload(commission);
    expect(row.status).toBe("PENDING");
    expect(row.disputeOpenedAt).not.toBeNull();
  });

  it("holds when the disputes cannot be read, and keeps holding on a won close it cannot confirm", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stripeStub.disputes.list.mockImplementation(async () => {
      throw Object.assign(new Error("permission"), { type: "StripePermissionError" });
    });
    const commission = await givenCommission({ payableAt: new Date(Date.now() - DAY) });
    try {
      await handleChargeDisputeCreated(merchant, dispute("needs_response"));
      await handleChargeDisputeClosed(merchant, dispute("won"));
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }

    const row = await reload(commission);
    expect(row.status).toBe("PENDING");
    expect(row.disputeOpenedAt).not.toBeNull();
  });

  it("holds a commission when the opening event's own dispute is missing from Stripe's list", async () => {
    // The list can briefly lag behind the event that reports the dispute.
    // Reading "clear" from an empty list would let the row be swept
    // PAYABLE, so the event's own dispute is folded in before reducing.
    const commission = await givenCommission();
    stripeStub.disputes.list.mockImplementation(async () => ({ data: [] }));

    await handleChargeDisputeCreated(merchant, dispute("needs_response"));

    const held = await reload(commission);
    expect(held.status).toBe("PENDING");
    expect(held.disputeOpenedAt).not.toBeNull();
  });

  it("voids an unpaid commission on a closed event with status lost whose dispute is missing from the list", async () => {
    const commission = await givenCommission();
    stripeStub.disputes.list.mockImplementation(async () => ({ data: [] }));

    await handleChargeDisputeClosed(merchant, dispute("lost"));

    const row = await reload(commission);
    expect(row.status).toBe("VOIDED");
    expect(row.voidReason).toBe("chargeback");
  });

  it("finds the payment through the charge when the dispute carries no PaymentIntent", async () => {
    const commission = await givenCommission();
    stripeStub.charges.retrieve.mockImplementation(async (id: string) => ({ id, payment_intent: PAYMENT_INTENT_ID }));
    disputesOnCharge("needs_response");

    await handleChargeDisputeCreated(merchant, dispute("needs_response", { payment_intent: null }));

    expect(stripeStub.charges.retrieve).toHaveBeenCalledWith("ch_dispute_test");
    expect((await reload(commission)).disputeOpenedAt).not.toBeNull();
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
    disputesOnCharge("needs_response");

    await handleChargeDisputeCreated(other, dispute("needs_response"));

    expect((await reload(commission)).disputeOpenedAt).toBeNull();
  });

  describe("a one-time sale with a post-purchase invoice Stripe links to the payment", () => {
    function invoiceLinked(invoiceId: string) {
      stripeStub.invoicePayments.list.mockImplementation(async () => ({
        data: [{ invoice: invoiceId, payment: { type: "payment_intent", payment_intent: PAYMENT_INTENT_ID } }],
      }));
    }

    it("holds a row stored under its PaymentIntent while the dispute is open", async () => {
      invoiceLinked("in_post");
      const commission = await givenCommission();
      disputesOnCharge("needs_response");

      await handleChargeDisputeCreated(merchant, dispute("needs_response"));

      expect((await reload(commission)).disputeOpenedAt).not.toBeNull();
    });

    it("holds a row stored under its invoice before 0.2.7 while the dispute is open", async () => {
      invoiceLinked("in_post");
      const commission = await givenCommission({ stripePaymentRef: "in_post" });
      disputesOnCharge("needs_response");

      await handleChargeDisputeCreated(merchant, dispute("needs_response"));

      expect((await reload(commission)).disputeOpenedAt).not.toBeNull();
    });

    it("voids a row stored under its PaymentIntent when the list already shows the dispute lost", async () => {
      invoiceLinked("in_post");
      const commission = await givenCommission();
      disputesOnCharge("lost");

      await handleChargeDisputeCreated(merchant, dispute("needs_response"));

      const row = await reload(commission);
      expect(row.status).toBe("VOIDED");
      expect(row.voidReason).toBe("chargeback");
    });
  });
});
