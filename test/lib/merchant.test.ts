// Destructive: runs db.merchant.deleteMany() / db.owner.deleteMany() before
// every test. Point DATABASE_URL at a disposable database, never a real
// deployment's data.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  createMerchant,
  listMerchantsForOwner,
  getMerchantForOwner,
  updateMerchant,
  getMerchantByDomain,
  getMerchantEmailCredentials,
} from "@/lib/merchant";

// Skip this whole suite cleanly when no database is reachable, instead of
// letting Prisma throw an opaque connection error mid-run. Checked once, up
// front, via a real connection attempt (not just "is DATABASE_URL set") so a
// stale/unreachable URL also skips rather than failing the suite.
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
    "Skipping test/lib/merchant.test.ts: no reachable DATABASE_URL. Set DATABASE_URL to a disposable database to run these tests."
  );
}

describe.skipIf(!hasDatabase)("merchant", () => {
  let ownerId: string;
  let otherOwnerId: string;

  beforeEach(async () => {
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
    const owner = await db.owner.create({
      data: { email: "merchant-test-owner@example.com", passwordHash: "x" },
    });
    ownerId = owner.id;
    const otherOwner = await db.owner.create({
      data: { email: "merchant-test-other-owner@example.com", passwordHash: "x" },
    });
    otherOwnerId = otherOwner.id;
  });

  afterAll(async () => {
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
    await db.$disconnect();
  });

  it("creates a Merchant and encrypts its credentials at rest", async () => {
    const { id } = await createMerchant(ownerId, {
      name: "InstantGradient",
      domain: "affiliates.instantgradient.com",
      websiteUrl: "https://example.com",
      stripeSecretKey: "sk_test_abc123",
      stripeWebhookSecret: "whsec_abc123",
      emailProviderConfig: "resend_api_key_abc",
    });

    const raw = await db.merchant.findUniqueOrThrow({ where: { id } });
    expect(raw.stripeSecretKeyEnc).not.toBe("sk_test_abc123");
    expect(raw.stripeSecretKeyEnc).toContain(":"); // iv:authTag:ciphertext format
    expect(raw.stripeWebhookSecretEnc).not.toBe("whsec_abc123");
    expect(raw.emailProviderConfigEnc).not.toBe("resend_api_key_abc");
  });

  it("lists only the calling Owner's Merchants", async () => {
    await createMerchant(ownerId, {
      name: "Mine",
      domain: "mine.example.com",
      websiteUrl: "https://example.com",
      stripeSecretKey: "sk_test_1",
      stripeWebhookSecret: "whsec_1",
      emailProviderConfig: "cfg1",
    });
    await createMerchant(otherOwnerId, {
      name: "NotMine",
      domain: "notmine.example.com",
      websiteUrl: "https://example.com",
      stripeSecretKey: "sk_test_2",
      stripeWebhookSecret: "whsec_2",
      emailProviderConfig: "cfg2",
    });

    const mine = await listMerchantsForOwner(ownerId);
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe("Mine");
  });

  it("returns null from getMerchantForOwner when the Merchant belongs to a different Owner", async () => {
    const { id } = await createMerchant(otherOwnerId, {
      name: "NotMine",
      domain: "notmine2.example.com",
      websiteUrl: "https://example.com",
      stripeSecretKey: "sk_test_3",
      stripeWebhookSecret: "whsec_3",
      emailProviderConfig: "cfg3",
    });

    const result = await getMerchantForOwner(ownerId, id);
    expect(result).toBeNull();
  });

  it("updateMerchant only overwrites provided credential fields, leaving others untouched", async () => {
    const { id } = await createMerchant(ownerId, {
      name: "Original",
      domain: "original.example.com",
      websiteUrl: "https://example.com",
      stripeSecretKey: "sk_test_original",
      stripeWebhookSecret: "whsec_original",
      emailProviderConfig: "cfg_original",
    });
    const before = await db.merchant.findUniqueOrThrow({ where: { id } });

    await updateMerchant(ownerId, id, {
      name: "Renamed",
      domain: "original.example.com",
      websiteUrl: "https://example.com",
      stripeSecretKey: "sk_test_new",
      // stripeWebhookSecret and emailProviderConfig intentionally omitted
    });

    const after = await db.merchant.findUniqueOrThrow({ where: { id } });
    expect(after.name).toBe("Renamed");
    expect(after.stripeSecretKeyEnc).not.toBe(before.stripeSecretKeyEnc);
    expect(after.stripeWebhookSecretEnc).toBe(before.stripeWebhookSecretEnc);
    expect(after.emailProviderConfigEnc).toBe(before.emailProviderConfigEnc);
  });

  it("updateMerchant throws when the Merchant belongs to a different Owner", async () => {
    const { id } = await createMerchant(otherOwnerId, {
      name: "NotMine",
      domain: "notmine3.example.com",
      websiteUrl: "https://example.com",
      stripeSecretKey: "sk_test_4",
      stripeWebhookSecret: "whsec_4",
      emailProviderConfig: "cfg4",
    });

    await expect(
      updateMerchant(ownerId, id, { name: "Hijacked", domain: "notmine3.example.com", websiteUrl: "https://example.com" })
    ).rejects.toThrow();
  });

  it("stores and returns websiteUrl verbatim (not a secret, never encrypted)", async () => {
    const { id } = await createMerchant(ownerId, {
      name: "InstantGradient",
      domain: "websiteurl-test.example.com",
      websiteUrl: "https://instantgradient.com",
      stripeSecretKey: "sk_test_abc123",
      stripeWebhookSecret: "whsec_abc123",
      emailProviderConfig: "resend_api_key_abc",
    });

    const result = await getMerchantForOwner(ownerId, id);
    expect(result?.websiteUrl).toBe("https://instantgradient.com");
  });

  it("getMerchantByDomain resolves a Merchant by its tracking domain, no owner required", async () => {
    await createMerchant(ownerId, {
      name: "InstantGradient",
      domain: "bydomain-test.example.com",
      websiteUrl: "https://instantgradient.com",
      stripeSecretKey: "sk_test_abc123",
      stripeWebhookSecret: "whsec_abc123",
      emailProviderConfig: "resend_api_key_abc",
    });

    const result = await getMerchantByDomain("bydomain-test.example.com");
    expect(result?.name).toBe("InstantGradient");
    expect(result?.websiteUrl).toBe("https://instantgradient.com");
  });

  it("getMerchantByDomain returns null for an unknown domain", async () => {
    const result = await getMerchantByDomain("nope.example.com");
    expect(result).toBeNull();
  });

  it("getMerchantEmailCredentials returns the encrypted config, unlike every other read path", async () => {
    const { id } = await createMerchant(ownerId, {
      name: "InstantGradient",
      domain: "emailcreds-test.example.com",
      websiteUrl: "https://instantgradient.com",
      stripeSecretKey: "sk_test_abc123",
      stripeWebhookSecret: "whsec_abc123",
      emailProviderConfig: "resend_api_key_abc",
    });

    const result = await getMerchantEmailCredentials(id);
    expect(result?.name).toBe("InstantGradient");
    expect(result?.domain).toBe("emailcreds-test.example.com");
    expect(result?.emailProviderConfigEnc).not.toBe("resend_api_key_abc");
    expect(result?.emailProviderConfigEnc).toContain(":"); // iv:authTag:ciphertext format
  });
});
