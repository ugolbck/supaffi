// Destructive: clears Email / Commission / Click / AffiliateLink / Affiliate /
// Program / Merchant / Owner. Runs against the scratch DATABASE_URL that
// test/setup.ts enforces, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { createAffiliate } from "@/lib/affiliate";
import { markCommissionsPaid } from "@/lib/commission";
import { emailPasswordLink, SELF_SERVE_LINK_TTL_MS } from "@/lib/notify";
import { createCommissionUnlessSelfReferral } from "@/lib/worker/recordCommission";
import { clearReferralTables, seedMerchant, seedOwner, seedReferral } from "./worker/referralFixtures";

process.env.MASTER_ENCRYPTION_KEY ??= "0".repeat(64);

const DAY = 24 * 60 * 60 * 1000;

async function clearAll() {
  await db.email.deleteMany();
  await db.affiliateLoginToken.deleteMany();
  await clearReferralTables();
}

async function ownerWithMail(switches: { notifyNewAffiliates?: boolean; notifyNewSales?: boolean; emailAffiliates?: boolean } = {}) {
  const owner = await seedOwner();
  return db.owner.update({
    where: { id: owner.id },
    data: { smtpHost: "smtp.example.com", smtpPort: 587, smtpUser: "u", smtpPasswordEnc: encrypt("p"), mailFrom: "hi@example.com", ...switches },
  });
}

function sale(affiliateId: string, clickId: string, ref: string, extra: { status?: "PENDING" | "FLAGGED" | "VOIDED" } = {}) {
  return createCommissionUnlessSelfReferral({
    data: {
      affiliateId,
      clickId,
      stripePaymentRef: ref,
      amount: "9.00",
      grossAmount: "9.00",
      saleAmount: "30.00",
      currency: "usd",
      status: extra.status ?? "PENDING",
      payableAt: new Date(Date.now() + 30 * DAY),
    },
  });
}

const keys = async () => (await db.email.findMany({ orderBy: { dedupeKey: "asc" } })).map((e) => e.dedupeKey.split(":")[0]);

describe("notifications", () => {
  beforeEach(clearAll);
  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("queues nothing while the owner has email off", async () => {
    const merchant = await seedMerchant((await seedOwner()).id);
    const { program, affiliate, click } = await seedReferral(merchant);
    await createAffiliate(merchant.id, program.id, { name: "Alice", email: "alice@example.com", passwordHash: "x" });
    await sale(affiliate.id, click.id, "in_1");

    expect(await db.email.count()).toBe(0);
  });

  it("tells the owner who joined, and welcomes the affiliate with their link and terms", async () => {
    const owner = await ownerWithMail();
    const merchant = await seedMerchant(owner.id);
    const { program } = await seedReferral(merchant);
    await createAffiliate(merchant.id, program.id, { name: "Alice", email: "alice@example.com", passwordHash: "x", code: "alice" });

    const emails = await db.email.findMany({ orderBy: { dedupeKey: "asc" } });
    expect(emails.map((e) => [e.dedupeKey.split(":")[0], e.to])).toEqual([
      ["joined", owner.email],
      ["welcome", "alice@example.com"],
    ]);
    expect(emails[0].subject).toBe("Alice joined your affiliate program");
    expect(emails[1].text).toContain("https://product.example.com?via=alice");
    expect(emails[1].text).toContain("You earn 20% of every payment. Share your link:");
    expect(emails.every((e) => e.fromName === "Product")).toBe(true);
  });

  it("follows the owner's switches", async () => {
    const merchant = await seedMerchant((await ownerWithMail({ notifyNewAffiliates: false })).id);
    const { program } = await seedReferral(merchant);
    await createAffiliate(merchant.id, program.id, { name: "Alice", email: "alice@example.com", passwordHash: "x" });

    expect(await keys()).toEqual(["welcome"]);
  });

  it("announces a referred customer's first sale to both, and not the renewals after it", async () => {
    const merchant = await seedMerchant((await ownerWithMail()).id);
    const { affiliate, click } = await seedReferral(merchant);
    await sale(affiliate.id, click.id, "in_1");
    await sale(affiliate.id, click.id, "in_2");

    const emails = await db.email.findMany({ orderBy: { dedupeKey: "asc" } });
    expect(emails.map((e) => e.dedupeKey.split(":")[0])).toEqual(["earned", "sale"]);
    expect(emails[0].subject).toBe("You earned $9.00");
    expect(emails[1].subject).toMatch(/^New sale from /);
    expect(emails[1].text).toContain("brought a $30.00 sale");
  });

  it("sends a flagged sale to the owner alone, and a voided one to nobody", async () => {
    const merchant = await seedMerchant((await ownerWithMail()).id);
    const flagged = await seedReferral(merchant);
    await sale(flagged.affiliate.id, flagged.click.id, "in_1", { status: "FLAGGED" });
    const voided = await seedReferral(merchant);
    await sale(voided.affiliate.id, voided.click.id, "in_2", { status: "VOIDED" });

    expect(await keys()).toEqual(["flagged"]);
  });

  it("sends one email for a payout, with its total", async () => {
    const merchant = await seedMerchant((await ownerWithMail({ notifyNewSales: false })).id);
    const { affiliate, click } = await seedReferral(merchant);
    await sale(affiliate.id, click.id, "in_1");
    await sale(affiliate.id, click.id, "in_2");
    const rows = await db.commission.findMany({ select: { id: true } });
    await db.commission.updateMany({ data: { status: "PAYABLE", payableAt: new Date(Date.now() - DAY) } });
    await db.email.deleteMany();

    await markCommissionsPaid(
      merchant.ownerId,
      merchant.id,
      rows.map((r) => ({ id: r.id, amount: "9.00" })),
      new Date(Date.now() - 1000).toISOString()
    );

    const emails = await db.email.findMany();
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe("Product paid you $18.00");
  });

  it("emails a password link that replaces any earlier one", async () => {
    const merchant = await seedMerchant((await ownerWithMail({ emailAffiliates: false })).id);
    const { affiliate } = await seedReferral(merchant);

    expect(await emailPasswordLink(affiliate.id, SELF_SERVE_LINK_TTL_MS)).toBe(true);
    expect(await emailPasswordLink(affiliate.id, SELF_SERVE_LINK_TTL_MS)).toBe(true);

    expect(await db.affiliateLoginToken.count({ where: { affiliateId: affiliate.id, usedAt: null } })).toBe(1);
    const emails = await db.email.findMany();
    expect(emails).toHaveLength(2);
    expect(emails[0].text).toMatch(/\/affiliates\/password\?token=[0-9a-f]{64}/);
    expect(emails[0].text).toContain("within 1 hour");
  });

  it("refuses a password link while email is off", async () => {
    const merchant = await seedMerchant((await seedOwner()).id);
    const { affiliate } = await seedReferral(merchant);

    expect(await emailPasswordLink(affiliate.id, SELF_SERVE_LINK_TTL_MS)).toBe(false);
    expect(await db.affiliateLoginToken.count()).toBe(0);
  });
});
