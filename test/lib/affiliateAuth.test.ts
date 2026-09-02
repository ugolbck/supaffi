// Destructive: runs db.affiliateLoginToken.deleteMany() / db.affiliate.deleteMany() /
// db.program.deleteMany() / db.merchant.deleteMany() / db.owner.deleteMany()
// before every test. Point DATABASE_URL at a disposable database, never a
// real deployment's data.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { createAffiliateLoginToken, consumeAffiliateLoginToken } from "@/lib/affiliateAuth";

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
    "Skipping test/lib/affiliateAuth.test.ts: no reachable DATABASE_URL. Set DATABASE_URL to a disposable database to run these tests."
  );
}

describe.skipIf(!hasDatabase)("affiliateAuth", () => {
  let affiliateId: string;

  beforeEach(async () => {
    await db.affiliateLoginToken.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();

    const owner = await db.owner.create({
      data: { email: "affauth-owner@example.com", passwordHash: "x" },
    });
    const merchant = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: owner.id,
        name: "TestCo",
        domain: "affauth-test.example.com",
        websiteUrl: "https://affauth-test.example.com",
        stripeSecretKeyEnc: "x",
        stripeWebhookSecretEnc: "x",
        emailProviderConfigEnc: "x",
      },
    });
    const program = await db.program.create({
      data: {
        slug: crypto.randomUUID(),
        merchantId: merchant.id,
        name: "Standard",
        defaultCommissionRate: "20.00",
        commissionDurationType: "FOREVER",
        attributionWindowDays: 60,
        holdingPeriodDays: 30,
      },
    });
    const affiliate = await db.affiliate.create({
      data: {
        merchantId: merchant.id,
        programId: program.id,
        email: "sarah@example.com",
        referralCode: "sarah",
      },
    });
    affiliateId = affiliate.id;
  });

  afterAll(async () => {
    await db.affiliateLoginToken.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
    await db.$disconnect();
  });

  it("issues a token that consumeAffiliateLoginToken can redeem exactly once", async () => {
    const rawToken = await createAffiliateLoginToken(affiliateId);

    const first = await consumeAffiliateLoginToken(rawToken);
    expect(first).toEqual({ id: affiliateId, email: "sarah@example.com" });

    const second = await consumeAffiliateLoginToken(rawToken);
    expect(second).toBeNull();
  });

  it("rejects an unknown token", async () => {
    const result = await consumeAffiliateLoginToken("not-a-real-token");
    expect(result).toBeNull();
  });

  it("rejects an expired token", async () => {
    const rawToken = await createAffiliateLoginToken(affiliateId);
    await db.affiliateLoginToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await consumeAffiliateLoginToken(rawToken);
    expect(result).toBeNull();
  });
});
