// Destructive: clears the referral tables before every test. Point
// DATABASE_URL at a disposable database, never a real deployment's data.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { Merchant } from "@prisma/client";
import { db } from "@/lib/db";
import { processPolarEvent } from "@/lib/payments/polar/dispatch";
import type { PolarOrder } from "@/lib/payments/polar/types";
import { computeCommissionAmount } from "@/lib/worker/commission";
import { REFERRAL_CLIENT_REFERENCE_PREFIX, REFERRAL_METADATA_KEY } from "@/lib/referral";
import { clearReferralTables, seedOwner, seedReferral } from "../../worker/referralFixtures";

let merchant: Merchant;
let referral: Awaited<ReturnType<typeof seedReferral>>;

beforeEach(async () => {
  await db.webhookEvent.deleteMany();
  await clearReferralTables();
  const owner = await seedOwner();
  merchant = await db.merchant.create({
    data: {
      slug: crypto.randomUUID(),
      ownerId: owner.id,
      name: "Product",
      domain: `${crypto.randomUUID()}.example.com`,
      websiteUrl: "https://product.example.com",
      paymentProvider: "POLAR",
      paymentKeyEnc: "x",
    },
  });
  referral = await seedReferral(merchant, { affiliateEmail: "affiliate@example.com" });
});

afterAll(async () => {
  await db.webhookEvent.deleteMany();
  await clearReferralTables();
  await db.$disconnect();
});

function order(overrides: Partial<PolarOrder> = {}): PolarOrder {
  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    billing_reason: "purchase",
    net_amount: 10_000,
    refunded_amount: 0,
    currency: "usd",
    subscription_id: null,
    product_id: "prod_a",
    metadata: { reference_id: `${REFERRAL_CLIENT_REFERENCE_PREFIX}${referral.click.referralToken}` },
    customer: { email: "buyer@example.com", metadata: {} },
    subscription: null,
    ...overrides,
  };
}

const send = (type: string, data: unknown) => processPolarEvent(merchant, { type, data });
const commissions = () => db.commission.findMany({ orderBy: { createdAt: "asc" } });
const expected = (netMinor: number) => computeCommissionAmount(netMinor, "usd", 20).toNumber();

describe("Polar order.paid", () => {
  it("earns on a checkout link sale, after discount and before tax, and proves tracking works", async () => {
    const paid = order();
    await send("order.paid", paid);
    const [row] = await commissions();
    expect(row.paymentRef).toBe(paid.id);
    expect(row.amount.toNumber()).toBe(expected(10_000));
    expect(row.status).toBe("PENDING");
    expect((await db.merchant.findUniqueOrThrow({ where: { id: merchant.id } })).trackingVerifiedAt).not.toBeNull();
  });

  it("earns on a checkout the owner's code made, carrying Supaffi's own key", async () => {
    await send("order.paid", order({ metadata: { [REFERRAL_METADATA_KEY]: referral.click.referralToken } }));
    expect(await commissions()).toHaveLength(1);
  });

  it("ignores an order with no token, or a reference that is the owner's own", async () => {
    await send("order.paid", order({ metadata: {} }));
    await send("order.paid", order({ metadata: { reference_id: referral.click.referralToken } }));
    expect(await commissions()).toHaveLength(0);
  });

  it("writes one row for a redelivered order", async () => {
    const paid = order();
    await send("order.paid", paid);
    await send("order.paid", paid);
    expect(await commissions()).toHaveLength(1);
  });

  it("earns nothing on an order the owner excluded", async () => {
    await send("order.paid", order({ customer: { email: "buyer@example.com", metadata: { supaffi: "false" } } }));
    expect(await commissions()).toHaveLength(0);
  });

  it("flags an affiliate buying through their own link", async () => {
    await send("order.paid", order({ customer: { email: "Affiliate@Example.com", metadata: {} } }));
    expect((await commissions())[0].status).toBe("FLAGGED");
  });

  it("folds a refund already on the order into the new row", async () => {
    await send("order.paid", order({ refunded_amount: 5_000 }));
    expect((await commissions())[0].amount.toNumber()).toBe(expected(5_000));
  });
});

describe("Polar subscriptions", () => {
  it("earns on the first payment and every renewal, a move to yearly included", async () => {
    await send("order.paid", order({ billing_reason: "subscription_create", subscription_id: "sub_1" }));
    await send("order.paid", order({ billing_reason: "subscription_cycle", subscription_id: "sub_1", metadata: {} }));
    // On Polar, monthly and yearly are two products.
    await send("order.paid", order({ billing_reason: "subscription_update", subscription_id: "sub_1", product_id: "prod_yearly", metadata: {} }));
    expect(await commissions()).toHaveLength(3);
    const referred = await db.referredSubscription.findFirstOrThrow({ where: { subscriptionRef: "sub_1" } });
    expect(referred.firstPaymentRef).not.toBeNull();
  });

  it("starts earning after a free trial, on the first order that moved money", async () => {
    await send("order.paid", order({ billing_reason: "subscription_create", subscription_id: "sub_2", net_amount: 0 }));
    expect(await commissions()).toHaveLength(0);
    const first = order({ billing_reason: "subscription_cycle_after_trial", subscription_id: "sub_2", metadata: {} });
    await send("order.paid", first);
    const referred = await db.referredSubscription.findFirstOrThrow({ where: { subscriptionRef: "sub_2" } });
    expect(referred.firstPaymentRef).toBe(first.id);
    expect(await commissions()).toHaveLength(1);
  });

  it("stops a one-time program after its first payment", async () => {
    await db.program.update({ where: { id: referral.program.id }, data: { commissionDurationType: "ONE_TIME" } });
    await send("order.paid", order({ billing_reason: "subscription_create", subscription_id: "sub_3" }));
    await send("order.paid", order({ billing_reason: "subscription_cycle", subscription_id: "sub_3", metadata: {} }));
    expect(await commissions()).toHaveLength(1);
  });

  it("earns nothing on a renewal nobody referred, or on usage billing", async () => {
    await send("order.paid", order({ billing_reason: "subscription_cycle", subscription_id: "sub_unknown", metadata: {} }));
    await send("order.paid", order({ billing_reason: "subscription_create", subscription_id: "sub_4" }));
    await send("order.paid", order({ billing_reason: "subscription_meter_cycle", subscription_id: "sub_4", metadata: {} }));
    expect(await commissions()).toHaveLength(1);
  });

  it("records that a subscription ended, without touching what it earned", async () => {
    await send("order.paid", order({ billing_reason: "subscription_create", subscription_id: "sub_5" }));
    await send("subscription.revoked", { id: "sub_5" });
    const referred = await db.referredSubscription.findFirstOrThrow({ where: { subscriptionRef: "sub_5" } });
    expect(referred.cancelledAt).not.toBeNull();
    expect((await db.click.findUniqueOrThrow({ where: { id: referral.click.id } })).subscriptionCancelledAt).not.toBeNull();
    expect(await commissions()).toHaveLength(1);
  });
});

describe("Polar order.refunded", () => {
  it("keeps the share still paid after a partial refund, and voids a full one", async () => {
    const paid = order();
    await send("order.paid", paid);
    await send("order.refunded", { ...paid, refunded_amount: 2_500 });
    expect((await commissions())[0].amount.toNumber()).toBe(expected(7_500));

    await send("order.refunded", { ...paid, refunded_amount: 10_000 });
    const [row] = await commissions();
    expect(row.status).toBe("VOIDED");
    expect(row.voidReason).toBe("refund");
  });

  it("waits for a sale still in the queue rather than losing its refund", async () => {
    const paid = order();
    await db.webhookEvent.create({
      data: { merchantId: merchant.id, providerEventId: "msg_paid", payload: { type: "order.paid", data: paid }, status: "PENDING" },
    });
    await expect(send("order.refunded", { ...paid, refunded_amount: 10_000 })).rejects.toThrow(/retried/);

    await send("order.paid", paid);
    await db.webhookEvent.updateMany({ where: { providerEventId: "msg_paid" }, data: { status: "PROCESSED" } });
    await send("order.refunded", { ...paid, refunded_amount: 10_000 });
    expect((await commissions())[0].status).toBe("VOIDED");
  });

  it("ignores a refund of an order that never earned", async () => {
    await send("order.refunded", order({ refunded_amount: 10_000 }));
    expect(await commissions()).toHaveLength(0);
  });
});

it("ignores an event Supaffi does not handle", async () => {
  await send("subscription.canceled", { id: "sub_1" });
  expect(await commissions()).toHaveLength(0);
});
