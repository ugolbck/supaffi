// Destructive: runs db.click.deleteMany() / db.affiliateLink.deleteMany() /
// db.affiliate.deleteMany() / db.program.deleteMany() / db.merchant.deleteMany() /
// db.owner.deleteMany() before every test. Point DATABASE_URL at a disposable
// database, never a real deployment's data.
//
// AffiliateLink.code is globally unique across the instance, not scoped to a
// Merchant, so a code belonging to one Merchant resolves for any Host. The
// route used to enforce non-attribution across Merchants as part of the SQL
// row lookup; this branch moved it into an application-level comparison of
// the link's Affiliate.merchantId against the Host's resolved Merchant.id
// (src/app/api/track/route.ts). A regression there would silently attribute
// one Merchant's clicks to another and clicks become commissions, so this is
// the one guard on this endpoint that must not merge untested.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { GET } from "@/app/api/track/route";
import { REFERRAL_QUERY_PARAM } from "@/lib/referral";

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
    "Skipping test/app/api/track/route.test.ts: no reachable DATABASE_URL. Set DATABASE_URL to a disposable database to run these tests."
  );
}

async function seedMerchantWithAffiliate(tag: string) {
  const owner = await db.owner.create({
    data: { email: `track-route-${tag}-owner@example.com`, passwordHash: "x" },
  });
  const merchant = await db.merchant.create({
    data: {
      slug: crypto.randomUUID(),
      ownerId: owner.id,
      name: `Track Route ${tag}`,
      domain: `track-route-${tag}.example.com`,
      websiteUrl: `https://track-route-${tag}.example.com`,
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
      email: `track-route-${tag}@example.com`,
      links: { create: { code: `track-route-${tag}-code`, isPrimary: true } },
    },
  });
  const link = await db.affiliateLink.findFirstOrThrow({ where: { affiliateId: affiliate.id } });
  return { merchant, affiliate, link };
}

function requestFor(host: string, code: string): NextRequest {
  return new NextRequest(`http://${host}/api/track?${REFERRAL_QUERY_PARAM}=${code}`, {
    headers: { host },
  });
}

describe.skipIf(!hasDatabase)("GET /api/track", () => {
  beforeEach(async () => {
    await db.click.deleteMany();
    await db.affiliateLink.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
  });

  afterAll(async () => {
    await db.click.deleteMany();
    await db.affiliateLink.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
    await db.$disconnect();
  });

  it("404s and records no Click when the code's Merchant does not match the requesting Host's Merchant", async () => {
    const a = await seedMerchantWithAffiliate("a");
    const b = await seedMerchantWithAffiliate("b");

    // Merchant A's own code, requested on Merchant B's Host.
    const res = await GET(requestFor(b.merchant.domain, a.link.code));

    expect(res.status).toBe(404);
    expect(await db.click.count()).toBe(0);
  });

  it("attributes a click when the code and the Host belong to the same Merchant", async () => {
    const a = await seedMerchantWithAffiliate("a");
    await seedMerchantWithAffiliate("b"); // present to prove the match isn't accidental

    const res = await GET(requestFor(a.merchant.domain, a.link.code));

    expect(res.status).toBe(200);
    const clicks = await db.click.findMany();
    expect(clicks).toHaveLength(1);
    expect(clicks[0].affiliateId).toBe(a.affiliate.id);
    expect(clicks[0].linkId).toBe(a.link.id);
  });
});
