// Destructive: runs db.program.deleteMany() / db.merchant.deleteMany() /
// db.owner.deleteMany() before every test. Point DATABASE_URL at a
// disposable database, never a real deployment's data.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  createProgram,
  listProgramsForMerchant,
  getProgramForMerchant,
  updateProgram,
  getProgramForSignup,
} from "@/lib/program";

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
    "Skipping test/lib/program.test.ts: no reachable DATABASE_URL. Set DATABASE_URL to a disposable database to run these tests."
  );
}

const baseInput = {
  name: "Standard",
  defaultCommissionRate: 20,
  commissionDurationType: "FOREVER" as const,
  commissionDurationMonths: null,
  attributionWindowDays: 60,
  holdingPeriodDays: 30,
};

describe.skipIf(!hasDatabase)("program", () => {
  let ownerId: string;
  let merchantId: string;
  let merchantId2: string;
  let otherOwnerId: string;
  let otherMerchantId: string;

  beforeEach(async () => {
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();

    const owner = await db.owner.create({
      data: { email: "program-test-owner@example.com", passwordHash: "x" },
    });
    ownerId = owner.id;
    const merchant = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId,
        name: "M",
        domain: "program-test.example.com",
        websiteUrl: "https://example.com",
        stripeSecretKeyEnc: "x",
        stripeWebhookSecretEnc: "x",
        emailProviderConfigEnc: "x",
      },
    });
    merchantId = merchant.id;

    // A second Merchant owned by the SAME Owner — the boundary that
    // getProgramForMerchant/updateProgram's `where: { id, merchantId }`
    // filter (scoped in addition to the ownership check) protects against.
    const merchant2 = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId,
        name: "M2",
        domain: "program-test-2.example.com",
        websiteUrl: "https://example.com",
        stripeSecretKeyEnc: "x",
        stripeWebhookSecretEnc: "x",
        emailProviderConfigEnc: "x",
      },
    });
    merchantId2 = merchant2.id;

    const otherOwner = await db.owner.create({
      data: { email: "program-test-other-owner@example.com", passwordHash: "x" },
    });
    otherOwnerId = otherOwner.id;
    const otherMerchant = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: otherOwnerId,
        name: "OM",
        domain: "program-test-other.example.com",
        websiteUrl: "https://example.com",
        stripeSecretKeyEnc: "x",
        stripeWebhookSecretEnc: "x",
        emailProviderConfigEnc: "x",
      },
    });
    otherMerchantId = otherMerchant.id;
  });

  afterAll(async () => {
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
    await db.$disconnect();
  });

  it("creates a Program under a Merchant the Owner owns", async () => {
    const { id } = await createProgram(ownerId, merchantId, baseInput);
    const raw = await db.program.findUniqueOrThrow({ where: { id } });
    expect(raw.name).toBe("Standard");
    expect(Number(raw.defaultCommissionRate)).toBe(20);
  });

  it("refuses to create a Program under a Merchant the Owner doesn't own", async () => {
    await expect(createProgram(ownerId, otherMerchantId, baseInput)).rejects.toThrow();
  });

  it("lists only Programs for the given, owned Merchant", async () => {
    await createProgram(ownerId, merchantId, baseInput);
    const list = await listProgramsForMerchant(ownerId, merchantId);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Standard");
  });

  it("getProgramForMerchant returns null when the Merchant isn't owned by the caller", async () => {
    const { slug } = await db.program.create({
      data: {
        merchantId: otherMerchantId,
        slug: crypto.randomUUID(),
        ...baseInput,
        defaultCommissionRate: 20,
      },
    });
    const result = await getProgramForMerchant(ownerId, otherMerchantId, slug);
    expect(result).toBeNull();
  });

  it("getProgramForMerchant returns null for a Program under a different Merchant owned by the SAME Owner", async () => {
    const { slug } = await createProgram(ownerId, merchantId, baseInput);
    const result = await getProgramForMerchant(ownerId, merchantId2, slug);
    expect(result).toBeNull();
  });

  it("updateProgram updates fields and validates FIXED_MONTHS requires commissionDurationMonths", async () => {
    const { id } = await createProgram(ownerId, merchantId, baseInput);
    await updateProgram(ownerId, merchantId, id, {
      ...baseInput,
      name: "Renamed",
      commissionDurationType: "FIXED_MONTHS",
      commissionDurationMonths: 12,
    });
    const raw = await db.program.findUniqueOrThrow({ where: { id } });
    expect(raw.name).toBe("Renamed");
    expect(raw.commissionDurationType).toBe("FIXED_MONTHS");
    expect(raw.commissionDurationMonths).toBe(12);
  });

  it("updateProgram throws when the Merchant isn't owned by the caller", async () => {
    const { id } = await db.program.create({
      data: { merchantId: otherMerchantId, slug: crypto.randomUUID(), ...baseInput },
    });
    await expect(
      updateProgram(ownerId, otherMerchantId, id, { ...baseInput, name: "Hijacked" })
    ).rejects.toThrow();
  });

  it("getProgramForSignup resolves a Program scoped to its Merchant, no owner required", async () => {
    const { slug } = await createProgram(ownerId, merchantId, baseInput);

    const result = await getProgramForSignup(merchantId, slug);
    expect(result?.name).toBe("Standard");
  });

  it("getProgramForSignup returns null when the Program belongs to a different Merchant", async () => {
    const { slug } = await createProgram(ownerId, merchantId, baseInput);

    const result = await getProgramForSignup(merchantId2, slug);
    expect(result).toBeNull();
  });
});
