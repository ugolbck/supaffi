// Destructive: runs db.affiliateLink.deleteMany() / db.affiliate.deleteMany() /
// db.program.deleteMany() / db.merchant.deleteMany() / db.owner.deleteMany()
// before every test. Point DATABASE_URL at a disposable database, never a
// real deployment's data.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { generateLinkCode } from "@/lib/referralCode";

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
    "Skipping test/lib/referralCode.test.ts: no reachable DATABASE_URL. Set DATABASE_URL to a disposable database to run these tests."
  );
}

describe.skipIf(!hasDatabase)("generateLinkCode", () => {
  let merchantId: string;
  let programId: string;

  beforeEach(async () => {
    await db.affiliateLink.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();

    const owner = await db.owner.create({
      data: { email: "refcode-owner@example.com", passwordHash: "x" },
    });
    const merchant = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: owner.id,
        name: "TestCo",
        domain: "refcode-test.example.com",
        websiteUrl: "https://refcode-test.example.com",
        stripeSecretKeyEnc: "x",
        stripeWebhookSecretEnc: "x",
        emailProviderConfigEnc: "x",
      },
    });
    merchantId = merchant.id;
    const program = await db.program.create({
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
    programId = program.id;
  });

  afterAll(async () => {
    await db.affiliateLink.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
    await db.$disconnect();
  });

  async function makeAffiliateWithCode(email: string, code: string) {
    const affiliate = await db.affiliate.create({
      data: { merchantId, programId, email },
    });
    await db.affiliateLink.create({
      data: { affiliateId: affiliate.id, code, isPrimary: true },
    });
    return affiliate;
  }

  it("slugifies a name into a lowercase referral code", async () => {
    const code = await generateLinkCode("Sarah Chen");
    expect(code).toBe("sarahchen");
  });

  it("keeps digits in the code as-is", async () => {
    const code = await generateLinkCode("Agent47");
    expect(code).toBe("agent47");
  });

  it("appends a numeric suffix on collision", async () => {
    await makeAffiliateWithCode("sarah1@example.com", "sarah");

    const code = await generateLinkCode("Sarah");
    expect(code).toBe("sarah2");
  });

  it("keeps incrementing past one collision", async () => {
    await makeAffiliateWithCode("sarah1@example.com", "sarah");
    await makeAffiliateWithCode("sarah2@example.com", "sarah2");

    const code = await generateLinkCode("Sarah");
    expect(code).toBe("sarah3");
  });

  it("falls back to \"affiliate\" for a name with no letters or digits", async () => {
    const code = await generateLinkCode("!!!");
    expect(code).toBe("affiliate");
  });
});
