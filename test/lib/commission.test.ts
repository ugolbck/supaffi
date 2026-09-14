// Destructive: runs db.commission.deleteMany() / db.click.deleteMany() /
// db.affiliateLink.deleteMany() / db.affiliate.deleteMany() /
// db.program.deleteMany() / db.merchant.deleteMany() / db.owner.deleteMany()
// before every test. Point DATABASE_URL at a disposable database, never a
// real deployment's data.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  listCommissions,
  getCommissionTotals,
  getCommissionFilterOptions,
  markCommissionsPaid,
  confirmCommissionFraud,
  dismissCommissionFlag,
  voidCommission,
  type CommissionFilters,
} from "@/lib/commission";

const NO_FILTERS: CommissionFilters = {
  status: null,
  affiliateId: null,
  currency: null,
  query: null,
};

const PAGE = { page: 1, pageSize: 25 };

let hasDatabase = false;
if (process.env.DATABASE_URL) {
  try {
    await db.$connect();
    hasDatabase = true;
  } catch {
    hasDatabase = false;
  }
}

if (!hasDatabase) {
  // eslint-disable-next-line no-console
  console.warn(
    "Skipping test/lib/commission.test.ts: no reachable DATABASE_URL. Set DATABASE_URL to a disposable database to run these tests."
  );
}

async function makeMerchant(ownerId: string, suffix: string) {
  return db.merchant.create({
    data: {
      slug: crypto.randomUUID(),
      ownerId,
      name: `Merchant ${suffix}`,
      domain: `commission-test-${suffix}.example.com`,
      websiteUrl: `https://commission-test-${suffix}.example.com`,
      stripeSecretKeyEnc: "x",
      stripeWebhookSecretEnc: "x",
      emailProviderConfigEnc: "x",
    },
  });
}

async function makeProgram(merchantId: string) {
  return db.program.create({
    data: {
      slug: crypto.randomUUID(),
      merchantId,
      name: "Standard",
      defaultCommissionRate: "20.00",
      commissionDurationType: "FOREVER",
      attributionWindowDays: 60,
      holdingPeriodDays: 30,
    },
  });
}

async function makeAffiliate(merchantId: string, programId: string, suffix: string) {
  return db.affiliate.create({
    data: {
      merchantId,
      programId,
      email: `affiliate-${suffix}@example.com`,
      name: `Affiliate ${suffix}`,
      links: { create: { code: `aff${suffix}`, isPrimary: true } },
    },
  });
}

async function makeClick(affiliateId: string) {
  return db.click.create({
    data: {
      affiliateId,
      referralToken: `token-${Math.random().toString(36).slice(2)}`,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    },
  });
}

async function makeCommission(
  affiliateId: string,
  clickId: string,
  overrides: Partial<{
    amount: string;
    grossAmount: string;
    currency: string;
    status: "PENDING" | "FLAGGED" | "PAYABLE" | "PAID" | "VOIDED";
    payableAt: Date;
    flagReason: string;
    voidReason: string;
    voidedAt: Date;
    stripePaymentRef: string;
    adjustsCommissionId: string;
  }>
) {
  return db.commission.create({
    data: {
      affiliateId,
      clickId,
      amount: overrides.amount ?? "10.00",
      grossAmount: overrides.grossAmount ?? overrides.amount ?? "10.00",
      currency: overrides.currency ?? "usd",
      status: overrides.status ?? "PAYABLE",
      payableAt: overrides.payableAt ?? new Date(Date.now() - 1000),
      flagReason: overrides.flagReason,
      voidReason: overrides.voidReason,
      voidedAt: overrides.voidedAt,
      stripePaymentRef: overrides.stripePaymentRef,
      adjustsCommissionId: overrides.adjustsCommissionId,
    },
  });
}

/** What a page would bind for these rows: each id with its amount as rendered. */
function shownOf(...rows: { id: string; amount: { toFixed(places: number): string } }[]) {
  return rows.map((row) => ({ id: row.id, amount: row.amount.toFixed(2) }));
}

/** The moment a page is rendered, as the page binds it. */
function loadedNow(): string {
  return new Date().toISOString();
}

describe.skipIf(!hasDatabase)("commission", () => {
  let ownerId: string;
  let merchantId: string;
  let otherMerchantId: string;
  let programId: string;

  beforeEach(async () => {
    await db.commission.deleteMany();
    await db.referredSubscription.deleteMany();
    await db.click.deleteMany();
    await db.affiliateLink.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();

    const owner = await db.owner.create({
      data: { email: "commission-test-owner@example.com", passwordHash: "x" },
    });
    ownerId = owner.id;
    const merchant = await makeMerchant(ownerId, "1");
    merchantId = merchant.id;
    const otherMerchant = await makeMerchant(ownerId, "2");
    otherMerchantId = otherMerchant.id;
    const program = await makeProgram(merchantId);
    programId = program.id;
  });

  afterAll(async () => {
    await db.commission.deleteMany();
    await db.referredSubscription.deleteMany();
    await db.click.deleteMany();
    await db.affiliateLink.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
    await db.$disconnect();
  });

  it("returns every status in one list, newest first", async () => {
    // The whole point of the ledger: a PENDING commission used to be visible
    // to the affiliate and invisible to the Owner, because the only Owner
    // views queried PAYABLE and FLAGGED.
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { status: "PENDING" });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { status: "PAYABLE" });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { status: "FLAGGED" });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { status: "PAID" });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { status: "VOIDED" });

    const { rows, total } = await listCommissions(ownerId, merchantId, NO_FILTERS, PAGE);

    expect(total).toBe(5);
    expect(new Set(rows.map((r) => r.status))).toEqual(
      new Set(["PENDING", "PAYABLE", "FLAGGED", "PAID", "VOIDED"])
    );
    const timestamps = rows.map((r) => r.createdAt.getTime());
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
  });

  it("filters by status, affiliate and currency", async () => {
    const sarah = await makeAffiliate(merchantId, programId, "sarah");
    const rob = await makeAffiliate(merchantId, programId, "rob");
    await makeCommission(sarah.id, (await makeClick(sarah.id)).id, {
      status: "PENDING",
      currency: "usd",
    });
    await makeCommission(sarah.id, (await makeClick(sarah.id)).id, {
      status: "PAYABLE",
      currency: "eur",
    });
    await makeCommission(rob.id, (await makeClick(rob.id)).id, { status: "PENDING" });

    const byStatus = await listCommissions(
      ownerId,
      merchantId,
      { ...NO_FILTERS, status: "PENDING" },
      PAGE
    );
    expect(byStatus.total).toBe(2);

    const byAffiliate = await listCommissions(
      ownerId,
      merchantId,
      { ...NO_FILTERS, affiliateId: sarah.id },
      PAGE
    );
    expect(byAffiliate.total).toBe(2);

    const byCurrency = await listCommissions(
      ownerId,
      merchantId,
      { ...NO_FILTERS, currency: "eur" },
      PAGE
    );
    expect(byCurrency.total).toBe(1);
  });

  it("searches the payment reference and the affiliate", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      stripePaymentRef: "in_1ABCxyz",
    });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      stripePaymentRef: "pi_9ZZZ",
    });

    const byRef = await listCommissions(
      ownerId,
      merchantId,
      { ...NO_FILTERS, query: "abcxyz" },
      PAGE
    );
    expect(byRef.total).toBe(1);

    const byEmail = await listCommissions(
      ownerId,
      merchantId,
      { ...NO_FILTERS, query: "affiliate-sarah" },
      PAGE
    );
    expect(byEmail.total).toBe(2);
  });

  it("never shows a different Merchant's commissions", async () => {
    const otherAffiliate = await db.affiliate.create({
      data: {
        merchantId: otherMerchantId,
        programId: (await makeProgram(otherMerchantId)).id,
        email: "other-affiliate@example.com",
        links: { create: { code: "other", isPrimary: true } },
      },
    });
    await makeCommission(otherAffiliate.id, (await makeClick(otherAffiliate.id)).id, {});

    const { total } = await listCommissions(ownerId, merchantId, NO_FILTERS, PAGE);
    expect(total).toBe(0);
  });

  it("totals per status keep currencies apart rather than summing them", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      status: "PAYABLE",
      amount: "10.00",
      currency: "usd",
    });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      status: "PAYABLE",
      amount: "15.50",
      currency: "usd",
    });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      status: "PAYABLE",
      amount: "9.00",
      currency: "eur",
    });

    const totals = await getCommissionTotals(ownerId, merchantId);
    const payable = totals.find((t) => t.status === "PAYABLE")!;

    expect(payable.count).toBe(3);
    expect(payable.amounts).toEqual([
      { currency: "eur", total: "9.00" },
      { currency: "usd", total: "25.50" },
    ]);
  });

  it("offers only affiliates that actually have commissions as filter options", async () => {
    const withCommission = await makeAffiliate(merchantId, programId, "sarah");
    await makeAffiliate(merchantId, programId, "rob");
    await makeCommission(withCommission.id, (await makeClick(withCommission.id)).id, {
      currency: "usd",
    });

    const options = await getCommissionFilterOptions(ownerId, merchantId);
    expect(options.affiliates.map((a) => a.id)).toEqual([withCommission.id]);
    expect(options.currencies).toEqual(["usd"]);
  });

  it("marks exactly the selected commissions paid", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const first = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const second = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});

    const result = await markCommissionsPaid(ownerId, merchantId, shownOf(first), loadedNow());
    expect(result).toEqual({ count: 1, skipped: 0 });

    expect((await db.commission.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("PAID");
    expect((await db.commission.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
      "PAYABLE"
    );
  });

  it("leaves a sale that became payable after the page was rendered unpaid", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { amount: "10.00" });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { amount: "15.00" });

    const renderedAt = loadedNow();
    const { rows } = await listCommissions(
      ownerId,
      merchantId,
      { ...NO_FILTERS, status: "PAYABLE" },
      PAGE
    );
    expect(rows).toHaveLength(2);

    // A third crosses its holding-period boundary between render and click.
    const late = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "20.00",
    });

    const shown = rows.map((row) => ({ id: row.id, amount: row.amount }));
    expect(await markCommissionsPaid(ownerId, merchantId, shown, renderedAt)).toEqual({
      count: 2,
      skipped: 0,
    });
    expect((await db.commission.findUniqueOrThrow({ where: { id: late.id } })).status).toBe(
      "PAYABLE"
    );
  });

  it("refuses a selection spanning two currencies, which is not one payout", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const usd = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      currency: "usd",
    });
    const eur = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      currency: "eur",
    });

    const result = await markCommissionsPaid(ownerId, merchantId, shownOf(usd, eur), loadedNow());
    expect(result).toEqual({ error: expect.stringContaining("one currency") });
    expect((await db.commission.findUniqueOrThrow({ where: { id: usd.id } })).status).toBe(
      "PAYABLE"
    );
  });

  it("refuses a selection spanning two affiliates", async () => {
    const sarah = await makeAffiliate(merchantId, programId, "sarah");
    const rob = await makeAffiliate(merchantId, programId, "rob");
    const a = await makeCommission(sarah.id, (await makeClick(sarah.id)).id, {});
    const b = await makeCommission(rob.id, (await makeClick(rob.id)).id, {});

    const result = await markCommissionsPaid(ownerId, merchantId, shownOf(a, b), loadedNow());
    expect(result).toEqual({ error: expect.stringContaining("one affiliate") });
    expect((await db.commission.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("PAYABLE");
  });

  it("pays several rows of different amounts in one payout, with one moment", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const a = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { amount: "30.00" });
    const b = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { amount: "4.50" });
    const c = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { amount: "12.25" });

    expect(await markCommissionsPaid(ownerId, merchantId, shownOf(a, b, c), loadedNow())).toEqual({
      count: 3,
      skipped: 0,
    });

    const paid = await db.commission.findMany({ where: { id: { in: [a.id, b.id, c.id] } } });
    expect(paid.every((row) => row.status === "PAID")).toBe(true);
    expect(paid.map((row) => row.amount.toFixed(2)).sort()).toEqual(["12.25", "30.00", "4.50"]);
    expect(new Set(paid.map((row) => row.paidAt?.getTime())).size).toBe(1);
  });

  it("skips a shown commission that is not payable and pays the rest", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const payable = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const pending = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      status: "PENDING",
    });

    const result = await markCommissionsPaid(ownerId, merchantId, shownOf(payable, pending), loadedNow());
    expect(result).toEqual({ count: 1, skipped: 1 });
    expect((await db.commission.findUniqueOrThrow({ where: { id: payable.id } })).status).toBe("PAID");
    expect((await db.commission.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("PENDING");
  });

  it("records a shown commission a refund voided after the page loaded, at the amount shown", async () => {
    // The Owner saw 20.00 and sent 20.00. A paid commission is final, so the
    // refund that raced the click is the merchant's loss, not a gap in the ledger.
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const first = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const refunded = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const chargedBack = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const renderedAt = loadedNow();

    await db.commission.update({
      where: { id: refunded.id },
      data: { status: "VOIDED", voidedAt: new Date(), voidReason: "refund" },
    });
    await db.commission.update({
      where: { id: chargedBack.id },
      data: { status: "VOIDED", voidedAt: new Date(), voidReason: "chargeback" },
    });

    const result = await markCommissionsPaid(
      ownerId,
      merchantId,
      shownOf(first, refunded, chargedBack),
      renderedAt
    );
    expect(result).toEqual({ count: 3, skipped: 0 });
    for (const id of [refunded.id, chargedBack.id]) {
      const row = await db.commission.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe("PAID");
      expect(row.amount.toFixed(2)).toBe("10.00");
      expect(row.voidedAt).toBeNull();
      expect(row.voidReason).toBeNull();
    }
  });

  it("records a shown commission a partial refund lowered after the page loaded, at the amount shown", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const first = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const second = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const renderedAt = loadedNow();

    await db.commission.update({
      where: { id: second.id },
      data: { amount: "6.00", voidReason: "partial refund" },
    });

    const result = await markCommissionsPaid(ownerId, merchantId, shownOf(first, second), renderedAt);
    expect(result).toEqual({ count: 2, skipped: 0 });
    const row = await db.commission.findUniqueOrThrow({ where: { id: second.id } });
    expect(row.status).toBe("PAID");
    expect(row.amount.toFixed(2)).toBe("10.00");
    expect(row.voidReason).toBeNull();
  });

  it("keeps a reduction the Owner already saw", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const reduced = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "6.00",
      grossAmount: "10.00",
      voidReason: "partial refund",
    });

    expect(await markCommissionsPaid(ownerId, merchantId, shownOf(reduced), loadedNow())).toEqual({
      count: 1,
      skipped: 0,
    });
    const row = await db.commission.findUniqueOrThrow({ where: { id: reduced.id } });
    expect(row.status).toBe("PAID");
    expect(row.amount.toFixed(2)).toBe("6.00");
    expect(row.voidReason).toBe("partial refund");
  });

  it("skips a shown commission the Owner voided after the page loaded", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const kept = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const voided = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const renderedAt = loadedNow();

    await voidCommission(ownerId, merchantId, voided.id, "voided by owner");

    expect(await markCommissionsPaid(ownerId, merchantId, shownOf(kept, voided), renderedAt)).toEqual({
      count: 1,
      skipped: 1,
    });
    const row = await db.commission.findUniqueOrThrow({ where: { id: voided.id } });
    expect(row.status).toBe("VOIDED");
    expect(row.voidReason).toBe("voided by owner");
  });

  it("never reads an Owner's own void as the refund void it happens to spell the same way", async () => {
    // "refund" typed by an Owner must not read as the worker's own refund
    // void: payoutFor tells the two apart only by voidReason, and paying this
    // row over a stale render would overturn a decision the Owner made.
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const kept = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const voided = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const renderedAt = loadedNow();

    await voidCommission(ownerId, merchantId, voided.id, "refund");

    expect(await markCommissionsPaid(ownerId, merchantId, shownOf(kept, voided), renderedAt)).toEqual({
      count: 1,
      skipped: 1,
    });
    const row = await db.commission.findUniqueOrThrow({ where: { id: voided.id } });
    expect(row.status).toBe("VOIDED");
  });

  it("stores an Owner's typed reason distinguishably when it matches a worker reason, any case", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const voided = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});

    await voidCommission(ownerId, merchantId, voided.id, "Chargeback");

    const row = await db.commission.findUniqueOrThrow({ where: { id: voided.id } });
    expect(row.voidReason).not.toBe("chargeback");
    expect(row.voidReason).not.toBeNull();
    expect(row.voidReason!.toLowerCase()).not.toBe("chargeback");
    expect(row.voidReason).toContain("Chargeback");
    expect(row.voidReason).toContain("owner");
  });

  it("skips a shown commission a confirmed self referral voided after the page loaded", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click = await makeClick(affiliate.id);
    const flagged = await makeCommission(affiliate.id, click.id, { status: "FLAGGED", flagReason: "card", stripePaymentRef: "in_flag" });
    const sibling = await makeCommission(affiliate.id, click.id, { stripePaymentRef: "in_sib" });
    const renderedAt = loadedNow();

    await confirmCommissionFraud(ownerId, merchantId, flagged.id);

    expect(await markCommissionsPaid(ownerId, merchantId, shownOf(sibling), renderedAt)).toEqual({
      count: 0,
      skipped: 1,
    });
    expect((await db.commission.findUniqueOrThrow({ where: { id: sibling.id } })).status).toBe("VOIDED");
  });

  it("skips a commission a refund voided before the page loaded", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const voided = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      status: "VOIDED",
      voidReason: "refund",
      voidedAt: new Date(Date.now() - 60_000),
    });

    expect(await markCommissionsPaid(ownerId, merchantId, shownOf(voided), loadedNow())).toEqual({
      count: 0,
      skipped: 1,
    });
    expect((await db.commission.findUniqueOrThrow({ where: { id: voided.id } })).status).toBe("VOIDED");
  });

  it("never records more than a commission was worth before refunds", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const reduced = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "6.00",
      grossAmount: "10.00",
      voidReason: "partial refund",
    });
    const refunded = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const renderedAt = loadedNow();
    await db.commission.update({
      where: { id: refunded.id },
      data: { status: "VOIDED", voidedAt: new Date(), voidReason: "refund" },
    });

    const result = await markCommissionsPaid(
      ownerId,
      merchantId,
      [
        { id: reduced.id, amount: "12.00" },
        { id: refunded.id, amount: "10.01" },
      ],
      renderedAt
    );
    expect(result).toEqual({ count: 0, skipped: 2 });
    const row = await db.commission.findUniqueOrThrow({ where: { id: reduced.id } });
    expect(row.status).toBe("PAYABLE");
    expect(row.amount.toFixed(2)).toBe("6.00");
  });

  it("does not count a second press on an already paid payout as skipped", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const only = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const renderedAt = loadedNow();

    expect(await markCommissionsPaid(ownerId, merchantId, shownOf(only), renderedAt)).toEqual({ count: 1, skipped: 0 });
    expect(await markCommissionsPaid(ownerId, merchantId, shownOf(only), renderedAt)).toEqual({ count: 0, skipped: 0 });
  });

  it("refuses bound input that did not come from a page, and writes nothing", async () => {
    // Every bound argument is a value the browser posts, so it is checked
    // rather than trusted.
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const only = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const otherAffiliate = await db.affiliate.create({
      data: {
        merchantId: otherMerchantId,
        programId: (await makeProgram(otherMerchantId)).id,
        email: "other-affiliate@example.com",
        links: { create: { code: "other", isPrimary: true } },
      },
    });
    const foreign = await makeCommission(otherAffiliate.id, (await makeClick(otherAffiliate.id)).id, {});
    const now = loadedNow();

    expect(await markCommissionsPaid(ownerId, merchantId, [], now)).toEqual({
      error: expect.stringContaining("Nothing selected"),
    });
    const refused = [
      [[{ id: only.id, amount: "10" }], now],
      [[{ id: only.id, amount: "-10.00" }], now],
      [[{ id: only.id, amount: "0.00" }], now],
      [[{ id: only.id, amount: "10.00" }, { id: only.id, amount: "10.00" }], now],
      [[{ id: "", amount: "10.00" }], now],
      [[{ id: only.id, amount: "10.00" }, { id: foreign.id, amount: "10.00" }], now],
      [[{ id: only.id, amount: "10.00" }], "yesterday"],
      [[{ id: only.id, amount: "10.00" }], new Date(Date.now() + 60_000).toISOString()],
    ] as const;
    for (const [shown, renderedAt] of refused) {
      const result = await markCommissionsPaid(ownerId, merchantId, [...shown], renderedAt);
      expect(result).toEqual({ error: expect.stringContaining("refused") });
    }
    expect((await db.commission.findUniqueOrThrow({ where: { id: only.id } })).status).toBe("PAYABLE");
    expect((await db.commission.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe("PAYABLE");
  });

  it("refuses a shown list larger than any page could render, before any write", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const only = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const tooMany = Array.from({ length: 5001 }, (_, i) => ({
      id: i === 0 ? only.id : `not-a-real-id-${i}`,
      amount: "10.00",
    }));

    const result = await markCommissionsPaid(ownerId, merchantId, tooMany, loadedNow());
    expect(result).toEqual({ error: expect.stringContaining("refused") });
    expect((await db.commission.findUniqueOrThrow({ where: { id: only.id } })).status).toBe("PAYABLE");
  });

  it("voidCommission refuses a commission paid out between its check and its write", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const commission = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});

    const realFindFirst = db.commission.findFirst.bind(db.commission);
    const spy = vi.spyOn(db.commission, "findFirst").mockImplementationOnce((async (args: object) => {
      const result = await realFindFirst(args);
      await db.commission.update({ where: { id: commission.id }, data: { status: "PAID" } });
      return result;
    }) as unknown as typeof db.commission.findFirst);
    try {
      await expect(voidCommission(ownerId, merchantId, commission.id, "late")).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }
    expect((await db.commission.findUniqueOrThrow({ where: { id: commission.id } })).status).toBe("PAID");
  });

  it("confirmCommissionFraud voids the commission and preserves the original flagReason", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click = await makeClick(affiliate.id);
    const commission = await makeCommission(affiliate.id, click.id, {
      status: "FLAGGED",
      flagReason: "card",
    });

    await confirmCommissionFraud(ownerId, merchantId, commission.id);

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("VOIDED");
    expect(updated.voidReason).toBe("confirmed self-referral");
    expect(updated.voidedAt).not.toBeNull();
    expect(updated.flagReason).toBe("card");
    // The referral itself is marked, so its later renewals create nothing.
    const refreshedClick = await db.click.findUniqueOrThrow({ where: { id: click.id } });
    expect(refreshedClick.fraudConfirmedAt).not.toBeNull();
  });

  it("confirmCommissionFraud cancels the referral's other unpaid commissions and leaves paid ones paid", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click = await makeClick(affiliate.id);
    const otherClick = await makeClick(affiliate.id);
    const confirmed = await makeCommission(affiliate.id, click.id, { status: "FLAGGED", flagReason: "card", stripePaymentRef: "in_c" });
    const pending = await makeCommission(affiliate.id, click.id, { status: "PENDING", stripePaymentRef: "in_p" });
    const payable = await makeCommission(affiliate.id, click.id, { status: "PAYABLE", stripePaymentRef: "in_y" });
    const flagged = await makeCommission(affiliate.id, click.id, { status: "FLAGGED", flagReason: "card", stripePaymentRef: "in_f" });
    const paid = await makeCommission(affiliate.id, click.id, { status: "PAID", stripePaymentRef: "in_d" });
    const unrelated = await makeCommission(affiliate.id, otherClick.id, { status: "PENDING", stripePaymentRef: "in_u" });

    await confirmCommissionFraud(ownerId, merchantId, confirmed.id);

    const statusOf = async (id: string) => db.commission.findUniqueOrThrow({ where: { id } });
    for (const row of [confirmed, pending, payable, flagged]) {
      const updated = await statusOf(row.id);
      expect(updated.status).toBe("VOIDED");
      expect(updated.voidReason).toBe("confirmed self-referral");
      expect(updated.voidedAt).not.toBeNull();
    }
    expect((await statusOf(paid.id)).status).toBe("PAID");
    expect((await statusOf(unrelated.id)).status).toBe("PENDING");
    expect((await db.click.findUniqueOrThrow({ where: { id: otherClick.id } })).fraudConfirmedAt).toBeNull();
  });

  it("dismissCommissionFlag returns a still-holding commission to PENDING and clears the flag", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click = await makeClick(affiliate.id);
    const commission = await makeCommission(affiliate.id, click.id, {
      status: "FLAGGED",
      flagReason: "card",
      payableAt: new Date(Date.now() + 1000 * 60 * 60 * 24), // still in the future
    });

    await dismissCommissionFlag(ownerId, merchantId, commission.id);

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("PENDING");
    expect(updated.flagReason).toBeNull();
  });

  it("dismissCommissionFlag returns an already-eligible commission straight to PAYABLE", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click = await makeClick(affiliate.id);
    const commission = await makeCommission(affiliate.id, click.id, {
      status: "FLAGGED",
      flagReason: "card",
      payableAt: new Date(Date.now() - 1000), // already past the Holding Period
    });

    await dismissCommissionFlag(ownerId, merchantId, commission.id);

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("PAYABLE");
    expect(updated.flagReason).toBeNull();
  });

  it("dismissCommissionFlag keeps a disputed commission pending even past its Holding Period", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click = await makeClick(affiliate.id);
    const commission = await makeCommission(affiliate.id, click.id, {
      status: "FLAGGED",
      flagReason: "card",
      payableAt: new Date(Date.now() - 1000),
    });
    await db.commission.update({ where: { id: commission.id }, data: { disputeOpenedAt: new Date() } });

    await dismissCommissionFlag(ownerId, merchantId, commission.id);

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("PENDING");
    expect(updated.flagReason).toBeNull();
    expect(updated.disputeOpenedAt).not.toBeNull();
  });

  it("voidCommission voids a pending commission and records the reason", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click = await makeClick(affiliate.id);
    const commission = await makeCommission(affiliate.id, click.id, { status: "PENDING" });

    await voidCommission(ownerId, merchantId, commission.id, "buyer refunded outside Stripe");

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("VOIDED");
    expect(updated.voidReason).toBe("buyer refunded outside Stripe");
    expect(updated.voidedAt).not.toBeNull();
  });

  it("voidCommission voids a payable commission too", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click = await makeClick(affiliate.id);
    const commission = await makeCommission(affiliate.id, click.id, { status: "PAYABLE" });

    await voidCommission(ownerId, merchantId, commission.id, "voided by owner");

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("VOIDED");
  });

  it("voidCommission refuses a paid commission, since paid is terminal", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click = await makeClick(affiliate.id);
    const commission = await makeCommission(affiliate.id, click.id, { status: "PAID" });

    await expect(
      voidCommission(ownerId, merchantId, commission.id, "changed my mind")
    ).rejects.toThrow();

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("PAID");
    expect(updated.voidReason).toBeNull();
  });

  it("voidCommission refuses a commission that is already voided", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click = await makeClick(affiliate.id);
    const commission = await makeCommission(affiliate.id, click.id, { status: "VOIDED" });

    await expect(
      voidCommission(ownerId, merchantId, commission.id, "again")
    ).rejects.toThrow();
  });

  it("voidCommission refuses a refund adjustment row", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const original = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      status: "PAID",
    });
    const adjustment = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "-10.00",
      adjustsCommissionId: original.id,
    });

    await expect(
      voidCommission(ownerId, merchantId, adjustment.id, "looks wrong")
    ).rejects.toThrow();

    const updated = await db.commission.findUniqueOrThrow({ where: { id: adjustment.id } });
    expect(updated.status).toBe("PAYABLE");
    expect((await db.commission.findUniqueOrThrow({ where: { id: original.id } })).status).toBe(
      "PAID"
    );
  });

  it("voidCommission refuses a commission belonging to another Merchant", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click = await makeClick(affiliate.id);
    const commission = await makeCommission(affiliate.id, click.id, { status: "PENDING" });

    await expect(
      voidCommission(ownerId, otherMerchantId, commission.id, "wrong product")
    ).rejects.toThrow();

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("PENDING");
  });

  it("throws when the Merchant belongs to a different Owner", async () => {
    const otherOwner = await db.owner.create({
      data: { email: "commission-test-other-owner@example.com", passwordHash: "x" },
    });

    await expect(
      listCommissions(otherOwner.id, merchantId, NO_FILTERS, PAGE)
    ).rejects.toThrow();
  });
});
