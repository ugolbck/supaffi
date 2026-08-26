// Destructive: runs db.commission.deleteMany() / db.click.deleteMany() /
// db.affiliate.deleteMany() / db.program.deleteMany() / db.merchant.deleteMany()
// / db.owner.deleteMany() before every test. Point DATABASE_URL at a
// disposable database, never a real deployment's data.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  listPayableGroups,
  getPayoutGroupDetail,
  markPayoutGroupPaid,
  listFlaggedCommissions,
  confirmCommissionFraud,
  dismissCommissionFlag,
} from "@/lib/commission";

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
      referralCode: `aff${suffix}`,
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
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
    await db.$disconnect();
  });

  it("groups PAYABLE commissions by affiliate and currency, summing amounts", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click1 = await makeClick(affiliate.id);
    const click2 = await makeClick(affiliate.id);
    await makeCommission(affiliate.id, click1.id, { amount: "10.00", currency: "usd" });
    await makeCommission(affiliate.id, click2.id, { amount: "15.50", currency: "usd" });

    const { groups, totalGroups } = await listPayableGroups(ownerId, merchantId, {
      page: 1,
      pageSize: 10,
    });

    expect(totalGroups).toBe(1);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      affiliateId: affiliate.id,
      affiliateEmail: "affiliate-sarah@example.com",
      currency: "usd",
      totalAmount: "25.50",
      commissionCount: 2,
    });
  });

  it("keeps different currencies as separate groups, never summed together", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click1 = await makeClick(affiliate.id);
    const click2 = await makeClick(affiliate.id);
    await makeCommission(affiliate.id, click1.id, { amount: "10.00", currency: "usd" });
    await makeCommission(affiliate.id, click2.id, { amount: "10.00", currency: "eur" });

    const { groups } = await listPayableGroups(ownerId, merchantId, { page: 1, pageSize: 10 });

    expect(groups).toHaveLength(2);
    const currencies = groups.map((g) => g.currency).sort();
    expect(currencies).toEqual(["eur", "usd"]);
  });

  it("excludes non-PAYABLE commissions from the payout groups", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click = await makeClick(affiliate.id);
    await makeCommission(affiliate.id, click.id, { status: "PENDING" });

    const { groups } = await listPayableGroups(ownerId, merchantId, { page: 1, pageSize: 10 });
    expect(groups).toHaveLength(0);
  });

  it("does not include a different Merchant's commissions", async () => {
    const otherAffiliate = await db.affiliate.create({
      data: {
        merchantId: otherMerchantId,
        programId: (await makeProgram(otherMerchantId)).id,
        email: "other-affiliate@example.com",
        referralCode: "other",
      },
    });
    const click = await makeClick(otherAffiliate.id);
    await makeCommission(otherAffiliate.id, click.id, {});

    const { groups } = await listPayableGroups(ownerId, merchantId, { page: 1, pageSize: 10 });
    expect(groups).toHaveLength(0);
  });

  it("getPayoutGroupDetail returns the individual PAYABLE lines for one affiliate/currency", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click1 = await makeClick(affiliate.id);
    const click2 = await makeClick(affiliate.id);
    await makeCommission(affiliate.id, click1.id, { amount: "10.00", currency: "usd" });
    await makeCommission(affiliate.id, click2.id, { amount: "5.00", currency: "usd" });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, {
      amount: "99.00",
      currency: "eur",
    });

    const lines = await getPayoutGroupDetail(ownerId, merchantId, affiliate.id, "usd");
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.amount).sort()).toEqual(["10.00", "5.00"].sort());
  });

  it("markPayoutGroupPaid transitions only the matching group's commissions to PAID", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const usdClick = await makeClick(affiliate.id);
    const eurClick = await makeClick(affiliate.id);
    const usdCommission = await makeCommission(affiliate.id, usdClick.id, { currency: "usd" });
    const eurCommission = await makeCommission(affiliate.id, eurClick.id, { currency: "eur" });

    const result = await markPayoutGroupPaid(ownerId, merchantId, affiliate.id, "usd", [
      usdCommission.id,
    ]);
    expect(result.count).toBe(1);

    const updatedUsd = await db.commission.findUniqueOrThrow({ where: { id: usdCommission.id } });
    expect(updatedUsd.status).toBe("PAID");
    expect(updatedUsd.paidAt).not.toBeNull();

    const updatedEur = await db.commission.findUniqueOrThrow({ where: { id: eurCommission.id } });
    expect(updatedEur.status).toBe("PAYABLE");
  });

  it("markPayoutGroupPaid does not sweep up a commission that became PAYABLE after the page was loaded", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click1 = await makeClick(affiliate.id);
    const click2 = await makeClick(affiliate.id);
    await makeCommission(affiliate.id, click1.id, { amount: "10.00", currency: "usd" });
    await makeCommission(affiliate.id, click2.id, { amount: "15.00", currency: "usd" });

    const { groups } = await listPayableGroups(ownerId, merchantId, { page: 1, pageSize: 10 });
    const group = groups.find((g) => g.affiliateId === affiliate.id && g.currency === "usd");
    expect(group).toBeDefined();
    expect(group!.commissionIds).toHaveLength(2);

    // Simulate a third commission crossing its holding-period boundary
    // between the Merchant loading the page and clicking "Mark paid".
    const click3 = await makeClick(affiliate.id);
    const lateCommission = await makeCommission(affiliate.id, click3.id, {
      amount: "20.00",
      currency: "usd",
    });

    const result = await markPayoutGroupPaid(
      ownerId,
      merchantId,
      affiliate.id,
      "usd",
      group!.commissionIds
    );
    expect(result.count).toBe(2);

    for (const id of group!.commissionIds) {
      const updated = await db.commission.findUniqueOrThrow({ where: { id } });
      expect(updated.status).toBe("PAID");
    }

    const updatedLate = await db.commission.findUniqueOrThrow({
      where: { id: lateCommission.id },
    });
    expect(updatedLate.status).toBe("PAYABLE");
  });

  it("listFlaggedCommissions returns only FLAGGED commissions for this Merchant, paginated", async () => {
    const affiliate = await makeAffiliate(merchantId, programId, "sarah");
    const click = await makeClick(affiliate.id);
    await makeCommission(affiliate.id, click.id, {
      status: "FLAGGED",
      flagReason: "buyer email matches affiliate email",
    });
    await makeCommission(affiliate.id, (await makeClick(affiliate.id)).id, { status: "PAYABLE" });

    const { commissions, total } = await listFlaggedCommissions(ownerId, merchantId, {
      page: 1,
      pageSize: 10,
    });

    expect(total).toBe(1);
    expect(commissions).toHaveLength(1);
    expect(commissions[0].flagReason).toBe("buyer email matches affiliate email");
    expect(commissions[0].affiliateEmail).toBe("affiliate-sarah@example.com");
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
      listPayableGroups(otherOwner.id, merchantId, { page: 1, pageSize: 10 })
    ).rejects.toThrow();
  });
});
