// Destructive: runs db.affiliateLoginToken.deleteMany() / db.affiliateLink.deleteMany() /
// db.affiliate.deleteMany() / db.program.deleteMany() / db.merchant.deleteMany() /
// db.owner.deleteMany() before every test. Point DATABASE_URL at a disposable
// database, never a real deployment's data.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import {
  createAffiliatePasswordLink,
  redeemAffiliatePasswordLink,
  checkAffiliatePassword,
  findAffiliateForLogin,
} from "@/lib/affiliatePassword";

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
    "Skipping test/lib/affiliatePassword.test.ts: no reachable DATABASE_URL. Set DATABASE_URL to a disposable database to run these tests."
  );
}

const PASSWORD = "correct horse battery";

async function clearAll() {
  await db.affiliateLoginToken.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

async function seedProduct(ownerEmail: string, domain: string, affiliateEmail: string) {
  const owner = await db.owner.create({ data: { email: ownerEmail, passwordHash: "x" } });
  const merchant = await db.merchant.create({
    data: {
      slug: crypto.randomUUID(),
      ownerId: owner.id,
      name: "TestCo",
      domain,
      websiteUrl: `https://${domain}`,
      stripeSecretKeyEnc: "x",
      stripeWebhookSecretEnc: "x",
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
      email: affiliateEmail,
      links: { create: { code: crypto.randomUUID(), isPrimary: true } },
    },
  });
  return { ownerId: owner.id, merchantId: merchant.id, affiliateId: affiliate.id };
}

describe.skipIf(!hasDatabase)("affiliatePassword", () => {
  let mine: Awaited<ReturnType<typeof seedProduct>>;
  let other: Awaited<ReturnType<typeof seedProduct>>;

  beforeEach(async () => {
    await clearAll();
    mine = await seedProduct("affpw-owner@example.com", "affpw-mine.example.com", "sarah@example.com");
    other = await seedProduct("affpw-other@example.com", "affpw-other.example.com", "tom@example.com");
  });

  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  describe("createAffiliatePasswordLink", () => {
    it("refuses an Affiliate that belongs to another Owner", async () => {
      expect(await createAffiliatePasswordLink(mine.ownerId, other.merchantId, other.affiliateId)).toBeNull();
      expect(await db.affiliateLoginToken.count()).toBe(0);
    });

    it("refuses an Affiliate from another product of the same Owner", async () => {
      expect(await createAffiliatePasswordLink(mine.ownerId, mine.merchantId, other.affiliateId)).toBeNull();
      expect(await db.affiliateLoginToken.count()).toBe(0);
    });

    it("voids the earlier link, so only the newest copy works", async () => {
      const first = await createAffiliatePasswordLink(mine.ownerId, mine.merchantId, mine.affiliateId);
      const second = await createAffiliatePasswordLink(mine.ownerId, mine.merchantId, mine.affiliateId);
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();
      expect(await db.affiliateLoginToken.count({ where: { affiliateId: mine.affiliateId } })).toBe(1);

      expect(await redeemAffiliatePasswordLink(first!, mine.merchantId, PASSWORD)).toBeNull();
      expect(await redeemAffiliatePasswordLink(second!, mine.merchantId, PASSWORD)).toEqual({
        email: "sarah@example.com",
      });
    });
  });

  describe("redeemAffiliatePasswordLink", () => {
    it("sets the password once and refuses the same link afterwards", async () => {
      const link = await createAffiliatePasswordLink(mine.ownerId, mine.merchantId, mine.affiliateId);

      expect(await redeemAffiliatePasswordLink(link!, mine.merchantId, PASSWORD)).toEqual({
        email: "sarah@example.com",
      });
      const affiliate = await findAffiliateForLogin(mine.merchantId, "sarah@example.com");
      expect(await checkAffiliatePassword(affiliate, PASSWORD)).toEqual({
        id: mine.affiliateId,
        email: "sarah@example.com",
      });

      expect(await redeemAffiliatePasswordLink(link!, mine.merchantId, "another password here")).toBeNull();
      const after = await findAffiliateForLogin(mine.merchantId, "sarah@example.com");
      expect(after?.passwordHash).toBe(affiliate?.passwordHash);
    });

    it("refuses an expired link", async () => {
      const link = await createAffiliatePasswordLink(mine.ownerId, mine.merchantId, mine.affiliateId);
      await db.affiliateLoginToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

      expect(await redeemAffiliatePasswordLink(link!, mine.merchantId, PASSWORD)).toBeNull();
      expect((await findAffiliateForLogin(mine.merchantId, "sarah@example.com"))?.passwordHash).toBeNull();
    });

    it("refuses a link opened on another product", async () => {
      const link = await createAffiliatePasswordLink(mine.ownerId, mine.merchantId, mine.affiliateId);

      expect(await redeemAffiliatePasswordLink(link!, other.merchantId, PASSWORD)).toBeNull();
      expect((await findAffiliateForLogin(mine.merchantId, "sarah@example.com"))?.passwordHash).toBeNull();
    });

    it("refuses an unknown link", async () => {
      expect(await redeemAffiliatePasswordLink("not-a-real-token", mine.merchantId, PASSWORD)).toBeNull();
    });

    it("lets only one of two concurrent submits of the same link through", async () => {
      const link = await createAffiliatePasswordLink(mine.ownerId, mine.merchantId, mine.affiliateId);

      const results = await Promise.all([
        redeemAffiliatePasswordLink(link!, mine.merchantId, "first password here"),
        redeemAffiliatePasswordLink(link!, mine.merchantId, "second password here"),
      ]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    });
  });

  describe("checkAffiliatePassword", () => {
    it("accepts the right password and refuses a wrong one", async () => {
      await db.affiliate.update({
        where: { id: mine.affiliateId },
        data: { passwordHash: await hashPassword(PASSWORD) },
      });
      const affiliate = await findAffiliateForLogin(mine.merchantId, "Sarah@Example.com");

      expect(await checkAffiliatePassword(affiliate, PASSWORD)).toEqual({
        id: mine.affiliateId,
        email: "sarah@example.com",
      });
      expect(await checkAffiliatePassword(affiliate, "wrong password here")).toBeNull();
    });

    it("refuses an Affiliate with no password yet", async () => {
      const affiliate = await findAffiliateForLogin(mine.merchantId, "sarah@example.com");
      expect(affiliate?.passwordHash).toBeNull();
      expect(await checkAffiliatePassword(affiliate, PASSWORD)).toBeNull();
    });

    it("refuses when no Affiliate was found", async () => {
      expect(await checkAffiliatePassword(null, PASSWORD)).toBeNull();
    });
  });
});
