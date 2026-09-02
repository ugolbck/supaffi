// Destructive: clears Commission / Click / AffiliateLink / Affiliate / Program /
// Merchant / Owner. Runs against the scratch DATABASE_URL, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";

import { db } from "@/lib/db";
import { createAffiliate } from "@/lib/affiliate";
import { getPrimaryLink } from "@/lib/affiliateLink";

const hasDatabase = Boolean(process.env.DATABASE_URL);

async function clearAll() {
  await db.commission.deleteMany();
  await db.click.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

async function seedProgram() {
  const owner = await db.owner.create({
    data: { email: `owner-${crypto.randomUUID()}@example.com`, passwordHash: "x" },
  });
  const merchant = await db.merchant.create({
    data: {
      slug: crypto.randomUUID(),
      ownerId: owner.id,
      name: "InstantGradient",
      domain: `${crypto.randomUUID()}.example.com`,
      websiteUrl: "https://instantgradient.com",
    },
  });
  const program = await db.program.create({
    data: {
      merchantId: merchant.id,
      slug: "standard",
      name: "Standard",
      defaultCommissionRate: "20.00",
      commissionDurationType: "FOREVER",
      attributionWindowDays: 60,
      holdingPeriodDays: 30,
    },
  });
  return { owner, merchant, program };
}

afterAll(clearAll);

describe.skipIf(!hasDatabase)("affiliate links", () => {
  beforeEach(clearAll);

  it("gives a new affiliate exactly one primary link carrying their code", async () => {
    const { merchant, program } = await seedProgram();
    const created = await createAffiliate(merchant.id, program.id, {
      name: "Sarah",
      email: "sarah@example.com",
    });

    const links = await db.affiliateLink.findMany({ where: { affiliateId: created.id } });
    expect(links).toHaveLength(1);
    expect(links[0].isPrimary).toBe(true);
    expect(links[0].code).toBe("sarah");
    expect(links[0].destinationPath).toBeNull();

    const primary = await getPrimaryLink(created.id);
    expect(primary?.code).toBe("sarah");
  });

  it("gives two affiliates whose names slugify the same distinct codes", async () => {
    // The dedupe loop in generateLinkCode probes AffiliateLink.code, not
    // Affiliate directly, so this exercises that it still finds the
    // collision once the code lives on the new row.
    const { merchant, program } = await seedProgram();
    const first = await createAffiliate(merchant.id, program.id, {
      name: "Sarah",
      email: "sarah1@example.com",
    });
    const second = await createAffiliate(merchant.id, program.id, {
      name: "Sarah",
      email: "sarah2@example.com",
    });

    expect(first.referralCode).toBe("sarah");
    expect(second.referralCode).toBe("sarah2");

    const firstLink = await getPrimaryLink(first.id);
    const secondLink = await getPrimaryLink(second.id);
    expect(firstLink?.code).toBe("sarah");
    expect(secondLink?.code).toBe("sarah2");
  });
});
