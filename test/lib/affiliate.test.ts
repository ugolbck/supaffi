// Destructive: runs db.affiliate.deleteMany() / db.program.deleteMany() /
// db.merchant.deleteMany() / db.owner.deleteMany() before every test. Point
// DATABASE_URL at a disposable database, never a real deployment's data.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { createAffiliate, getAffiliateByEmail, getAffiliateSession } from "@/lib/affiliate";

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
    "Skipping test/lib/affiliate.test.ts: no reachable DATABASE_URL. Set DATABASE_URL to a disposable database to run these tests."
  );
}

describe.skipIf(!hasDatabase)("affiliate", () => {
  let merchantId: string;
  let programId: string;
  let otherMerchantId: string;
  let otherProgramId: string;

  beforeEach(async () => {
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();

    const owner = await db.owner.create({
      data: { email: "affiliate-lib-owner@example.com", passwordHash: "x" },
    });
    const merchant = await db.merchant.create({
      data: {
        ownerId: owner.id,
        name: "TestCo",
        domain: "affiliate-lib-test.example.com",
        websiteUrl: "https://affiliate-lib-test.example.com",
        stripeSecretKeyEnc: "x",
        stripeWebhookSecretEnc: "x",
        emailProviderConfigEnc: "x",
      },
    });
    merchantId = merchant.id;
    const program = await db.program.create({
      data: {
        merchantId,
        name: "Standard",
        defaultCommissionRate: "20.00",
        commissionDurationType: "FOREVER",
        attributionWindowDays: 60,
        holdingPeriodDays: 30,
      },
    });
    programId = program.id;

    const otherMerchant = await db.merchant.create({
      data: {
        ownerId: owner.id,
        name: "OtherCo",
        domain: "affiliate-lib-other.example.com",
        websiteUrl: "https://affiliate-lib-other.example.com",
        stripeSecretKeyEnc: "x",
        stripeWebhookSecretEnc: "x",
        emailProviderConfigEnc: "x",
      },
    });
    otherMerchantId = otherMerchant.id;
    const otherProgram = await db.program.create({
      data: {
        merchantId: otherMerchantId,
        name: "Standard",
        defaultCommissionRate: "20.00",
        commissionDurationType: "FOREVER",
        attributionWindowDays: 60,
        holdingPeriodDays: 30,
      },
    });
    otherProgramId = otherProgram.id;
  });

  afterAll(async () => {
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
    await db.$disconnect();
  });

  it("creates an Affiliate with a normalized email and a generated referral code", async () => {
    const affiliate = await createAffiliate(merchantId, programId, {
      name: "Sarah Chen",
      email: "  Sarah@Example.com  ",
    });

    expect(affiliate.email).toBe("sarah@example.com");
    expect(affiliate.referralCode).toBe("sarahchen");
  });

  it("getAffiliateByEmail is case/whitespace-insensitive on lookup", async () => {
    await createAffiliate(merchantId, programId, { name: "Sarah", email: "sarah@example.com" });

    const result = await getAffiliateByEmail(merchantId, "  SARAH@example.com ");
    expect(result?.email).toBe("sarah@example.com");
  });

  it("getAffiliateByEmail does not find an Affiliate that belongs to a different Merchant", async () => {
    await createAffiliate(otherMerchantId, otherProgramId, {
      name: "Sarah",
      email: "sarah@example.com",
    });

    const result = await getAffiliateByEmail(merchantId, "sarah@example.com");
    expect(result).toBeNull();
  });

  it("getAffiliateSession returns the referral code and the owning Merchant's real site", async () => {
    const affiliate = await createAffiliate(merchantId, programId, {
      name: "Sarah",
      email: "sarah@example.com",
    });

    const result = await getAffiliateSession(affiliate.id);
    expect(result).toEqual({
      referralCode: "sarah",
      merchantWebsiteUrl: "https://affiliate-lib-test.example.com",
    });
  });

  it("getAffiliateSession returns null for an unknown id", async () => {
    const result = await getAffiliateSession("does-not-exist");
    expect(result).toBeNull();
  });
});
