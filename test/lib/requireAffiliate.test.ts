// Destructive: runs db.affiliateLoginToken.deleteMany() / db.affiliateLink.deleteMany() /
// db.affiliate.deleteMany() / db.program.deleteMany() / db.merchant.deleteMany() /
// db.owner.deleteMany() before every test. Point DATABASE_URL at a disposable
// database, never a real deployment's data.
//
// requireAffiliate guards every screen under /affiliates/dashboard and every
// link mutation, and carries logic (the session check, and separately the
// host-to-Merchant check) that used to be written inline per page. It has no
// test of its own. This covers the host-mismatch case: a valid Affiliate
// session loading a different Merchant's host must redirect rather than
// render, which is the one check that only requireAffiliate performs (the
// session-role check alone would not catch it).
//
// requireAffiliate reads the session via auth() (next-auth, which pulls in
// native/wasm bits not worth loading here) and the request Host via
// next/headers' headers(). Both are mocked, the same way
// test/app/affiliates/signup/createAffiliateSignup.test.ts mocks next/headers.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";

const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: () => authMock(),
}));

const headersMock = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

// redirect() unwinds rendering via a mechanism that assumes a real request
// context this test has none of. Replaced with a stand-in that throws a
// plain, inspectable error carrying the path instead.
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

import { requireAffiliate } from "@/lib/affiliateAuth";

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
    "Skipping test/lib/requireAffiliate.test.ts: no reachable DATABASE_URL. Set DATABASE_URL to a disposable database to run these tests."
  );
}

describe.skipIf(!hasDatabase)("requireAffiliate", () => {
  let merchantA: { id: string; domain: string };
  let merchantB: { id: string; domain: string };
  let affiliateId: string;

  beforeEach(async () => {
    await db.affiliateLoginToken.deleteMany();
    await db.affiliateLink.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();

    authMock.mockReset();
    headersMock.mockReset();

    const owner = await db.owner.create({
      data: { email: "requireaffiliate-owner@example.com", passwordHash: "x" },
    });
    const a = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: owner.id,
        name: "Merchant A",
        domain: "requireaffiliate-a.example.com",
        websiteUrl: "https://requireaffiliate-a.example.com",
      },
    });
    const b = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: owner.id,
        name: "Merchant B",
        domain: "requireaffiliate-b.example.com",
        websiteUrl: "https://requireaffiliate-b.example.com",
      },
    });
    merchantA = { id: a.id, domain: a.domain };
    merchantB = { id: b.id, domain: b.domain };

    const program = await db.program.create({
      data: {
        slug: crypto.randomUUID(),
        merchantId: merchantA.id,
        name: "Standard",
        defaultCommissionRate: "20.00",
        commissionDurationType: "FOREVER",
        attributionWindowDays: 60,
        holdingPeriodDays: 30,
      },
    });
    const affiliate = await db.affiliate.create({
      data: {
        merchantId: merchantA.id,
        programId: program.id,
        email: "sarah@example.com",
        links: { create: { code: "sarah-requireaffiliate", isPrimary: true } },
      },
    });
    affiliateId = affiliate.id;
  });

  afterAll(async () => {
    await db.affiliateLoginToken.deleteMany();
    await db.affiliateLink.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
    await db.$disconnect();
  });

  it("redirects rather than render when a valid Affiliate session loads a different Merchant's host", async () => {
    authMock.mockResolvedValue({ user: { id: affiliateId, role: "affiliate" } });
    // Merchant A's Affiliate, but on Merchant B's own dashboard host.
    headersMock.mockResolvedValue(new Headers({ host: merchantB.domain }));

    await expect(requireAffiliate()).rejects.toThrow("REDIRECT:/affiliates/login");
  });

  it("returns the Affiliate and its own Merchant when the host matches", async () => {
    authMock.mockResolvedValue({ user: { id: affiliateId, role: "affiliate" } });
    headersMock.mockResolvedValue(new Headers({ host: merchantA.domain }));

    const result = await requireAffiliate();
    expect(result.affiliateId).toBe(affiliateId);
    expect(result.merchant.id).toBe(merchantA.id);
  });
});
