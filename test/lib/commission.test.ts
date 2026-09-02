// Destructive: runs db.commission.deleteMany() / db.click.deleteMany() /
// db.affiliateLink.deleteMany() / db.affiliate.deleteMany() /
// db.program.deleteMany() / db.merchant.deleteMany() / db.owner.deleteMany()
// before every test. Point DATABASE_URL at a disposable database, never a
// real deployment's data.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  listCommissions,
  getCommissionTotals,
  getCommissionFilterOptions,
  markCommissionsPaid,
  confirmCommissionFraud,
  dismissCommissionFlag,
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
    currency: string;
    status: "PENDING" | "FLAGGED" | "PAYABLE" | "PAID" | "VOIDED";
    payableAt: Date;
    flagReason: string;
    stripePaymentRef: string;
  }>
) {
  return db.commission.create({
    data: {
      affiliateId,
      clickId,
      amount: overrides.amount ?? "10.00",
      currency: overrides.currency ?? "usd",
      status: overrides.status ?? "PAYABLE",
      payableAt: overrides.payableAt ?? new Date(Date.now() - 1000),
      flagReason: overrides.flagReason,
      stripePaymentRef: overrides.stripePaymentRef,
    },
  });
}

describe.skipIf(!hasDatabase)("commission", () => {
  let ownerId: string;
  let merchantId: string;
  let otherMerchantId: string;
  let programId: string;

  beforeEach(async () => {
    await db.commission.deleteMany();
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

    const result = await markCommissionsPaid(ownerId, merchantId, [first.id]);
    expect(result).toEqual({ count: 1 });

    expect((await db.commission.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("PAID");
    expect((await db.commission.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
      "PAYABLE"
    );
  });

  it("does not sweep up a commission that became payable after the page was rendered", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { amount: "10.00" });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { amount: "15.00" });

    const { rows } = await listCommissions(
      ownerId,
      merchantId,
      { ...NO_FILTERS, status: "PAYABLE" },
      PAGE
    );
    const seen = rows.map((r) => r.id);
    expect(seen).toHaveLength(2);

    // A third crosses its holding-period boundary between render and click.
    const late = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "20.00",
    });

    expect(await markCommissionsPaid(ownerId, merchantId, seen)).toEqual({ count: 2 });
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

    const result = await markCommissionsPaid(ownerId, merchantId, [usd.id, eur.id]);
    expect(result).toEqual({ error: expect.stringContaining("one currency") });
    expect((await db.commission.findUniqueOrThrow({ where: { id: usd.id } })).status).toBe(
      "PAYABLE"
    );
  });

  it("refuses to pay out around an outstanding refund adjustment", async () => {
    // Marking only the positive rows paid would erase money the Affiliate owes
    // back, instead of carrying it forward against their next payout.
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const earned = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "30.00",
    });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { amount: "-10.00" });

    const result = await markCommissionsPaid(ownerId, merchantId, [earned.id]);
    expect(result).toEqual({ error: expect.stringContaining("refund adjustment") });
    expect((await db.commission.findUniqueOrThrow({ where: { id: earned.id } })).status).toBe(
      "PAYABLE"
    );
  });

  it("refuses a selection that owes money back overall", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const earned = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "5.00",
    });
    const clawback = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "-12.00",
    });

    const result = await markCommissionsPaid(ownerId, merchantId, [earned.id, clawback.id]);
    expect(result).toEqual({ error: expect.stringContaining("carries to the next payout") });
  });

  it("refuses ids that are no longer payable rather than silently paying fewer", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const payable = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {});
    const pending = await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      status: "PENDING",
    });

    const result = await markCommissionsPaid(ownerId, merchantId, [payable.id, pending.id]);
    expect(result).toEqual({ error: expect.stringContaining("no longer payable") });
    expect((await db.commission.findUniqueOrThrow({ where: { id: payable.id } })).status).toBe(
      "PAYABLE"
    );
  });

  it("confirmCommissionFraud voids the commission and preserves the original flagReason", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click = await makeClick(affiliate.id);
    const commission = await makeCommission(affiliate.id, click.id, {
      status: "FLAGGED",
      flagReason: "buyer email matches affiliate email",
    });

    await confirmCommissionFraud(ownerId, merchantId, commission.id);

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("VOIDED");
    expect(updated.voidReason).toBe("confirmed self-referral");
    expect(updated.voidedAt).not.toBeNull();
    expect(updated.flagReason).toBe("buyer email matches affiliate email");
  });

  it("dismissCommissionFlag returns a still-holding commission to PENDING and clears the flag", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click = await makeClick(affiliate.id);
    const commission = await makeCommission(affiliate.id, click.id, {
      status: "FLAGGED",
      flagReason: "buyer email matches affiliate email",
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
      flagReason: "buyer email matches affiliate email",
      payableAt: new Date(Date.now() - 1000), // already past the Holding Period
    });

    await dismissCommissionFlag(ownerId, merchantId, commission.id);

    const updated = await db.commission.findUniqueOrThrow({ where: { id: commission.id } });
    expect(updated.status).toBe("PAYABLE");
    expect(updated.flagReason).toBeNull();
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
