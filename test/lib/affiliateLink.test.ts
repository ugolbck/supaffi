// Destructive: clears Commission / Click / AffiliateLink / Affiliate / Program /
// Merchant / Owner. Runs against the scratch DATABASE_URL, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";

import { db } from "@/lib/db";
import { createAffiliate } from "@/lib/affiliate";
import {
  getPrimaryLink,
  createLink,
  updateLink,
  deleteLink,
  listLinksWithStats,
  validateLinkInput,
  MAX_LINKS_PER_AFFILIATE,
} from "@/lib/affiliateLink";

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

  it("rejects a code that is not a clean slug", () => {
    for (const bad of ["", "a", "Sarah Smith", "sarah!", "-sarah", "sarah-", "a".repeat(31)]) {
      const result = validateLinkInput({ code: bad, destinationPath: "" });
      expect("error" in result && result.error).toBeTruthy();
    }
  });

  it("accepts a clean slug and normalizes a blank destination to null", () => {
    const result = validateLinkInput({ code: "sarah-pricing", destinationPath: "  " });
    expect(result).toEqual({ code: "sarah-pricing", destinationPath: null, error: null });
  });

  it("rejects a destination that is not a path on the merchant's own site", () => {
    for (const bad of [
      "pricing",
      "https://evil.example.com",
      "//evil.example.com",
      "/a b",
      "/\\evil.com",
      "/pricing?utm_source=x",
      "/pricing#faq",
    ]) {
      const result = validateLinkInput({ code: "sarah", destinationPath: bad });
      expect("error" in result && result.error).toBeTruthy();
    }
  });

  it("refuses a code another affiliate already has", async () => {
    const { merchant, program } = await seedProgram();
    await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const bob = await createAffiliate(merchant.id, program.id, { name: "Bob", email: "b@example.com" });

    const result = await createLink(bob.id, { code: "sarah", destinationPath: "" });
    expect(result).toEqual({ error: "That code is already taken. Try another." });
  });

  it("will not delete the primary link", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const primary = await getPrimaryLink(sarah.id);

    const result = await deleteLink(sarah.id, primary!.id);
    expect(result).toEqual({ error: "Your signup link cannot be deleted." });
    expect(await db.affiliateLink.count({ where: { affiliateId: sarah.id } })).toBe(1);
  });

  it("will not touch another affiliate's link", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const bob = await createAffiliate(merchant.id, program.id, { name: "Bob", email: "b@example.com" });
    const sarahsLink = await getPrimaryLink(sarah.id);

    const result = await updateLink(bob.id, sarahsLink!.id, { code: "stolen", destinationPath: "" });
    expect(result).toEqual({ error: "That link no longer exists." });
    expect((await getPrimaryLink(sarah.id))!.code).toBe("sarah");
  });

  it("caps how many links one affiliate can hold", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    // One primary already exists, so this fills the allowance exactly.
    for (let i = 1; i < MAX_LINKS_PER_AFFILIATE; i++) {
      expect(await createLink(sarah.id, { code: `sarah-${i}`, destinationPath: "" })).toHaveProperty("id");
    }
    const result = await createLink(sarah.id, { code: "one-too-many", destinationPath: "" });
    expect(result).toEqual({
      error: `You can have up to ${MAX_LINKS_PER_AFFILIATE} links. Delete one to add another.`,
    });
  });

  it("counts clicks, conversions and earnings per link", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const primary = await getPrimaryLink(sarah.id);
    const second = await createLink(sarah.id, { code: "sarah-pricing", destinationPath: "/pricing" });
    const secondId = (second as { id: string }).id;

    // Two clicks on the primary, one of which converted. One click on the second.
    const converting = await db.click.create({
      data: {
        affiliateId: sarah.id,
        linkId: primary!.id,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    await db.click.create({
      data: {
        affiliateId: sarah.id,
        linkId: primary!.id,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    await db.click.create({
      data: {
        affiliateId: sarah.id,
        linkId: secondId,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    await db.commission.create({
      data: {
        affiliateId: sarah.id,
        clickId: converting.id,
        amount: "12.00",
        currency: "usd",
        status: "PAYABLE",
        payableAt: new Date(),
        stripePaymentRef: crypto.randomUUID(),
      },
    });

    const stats = await listLinksWithStats(sarah.id);
    expect(stats.map((s) => s.code)).toEqual(["sarah", "sarah-pricing"]);
    expect(stats[0]).toMatchObject({ clicks: 2, conversions: 1, isPrimary: true });
    expect(stats[0].earned).toEqual([{ currency: "usd", total: "12.00" }]);
    expect(stats[1]).toMatchObject({ clicks: 1, conversions: 0, earned: [] });
  });
});
