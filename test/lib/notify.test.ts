// Destructive: clears Email / Commission / Click / AffiliateLink / Affiliate /
// Program / Merchant / Owner. Runs against the scratch DATABASE_URL that
// test/setup.ts enforces, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { createAffiliate } from "@/lib/affiliate";
import { createAffiliateResetLink } from "@/lib/affiliatePassword";
import { markCommissionsPaid } from "@/lib/commission";
import { emailPasswordLink } from "@/lib/notify";
import { createCommissionUnlessSelfReferral } from "@/lib/worker/recordCommission";
import { clearReferralTables, seedMerchant, seedOwner, seedReferral } from "./worker/referralFixtures";

process.env.MASTER_ENCRYPTION_KEY ??= "0".repeat(64);

const DAY = 24 * 60 * 60 * 1000;

async function clearAll() {
  await db.email.deleteMany();
  await db.affiliateLoginToken.deleteMany();
  await clearReferralTables();
}

type Switches = { notifyNewAffiliates?: boolean; notifyNewSales?: boolean; emailAffiliates?: boolean };

/** A product with email on, and its owner. */
async function productWithMail(switches: Switches = {}) {
  const owner = await seedOwner();
  const merchant = await db.merchant.update({
    where: { id: (await seedMerchant(owner.id)).id },
    data: { smtpHost: "smtp.example.com", smtpPort: 587, smtpUser: "u", smtpPasswordEnc: encrypt("p"), mailFrom: "hi@example.com", ...switches },
  });
  return { owner, merchant };
}

function sale(affiliateId: string, clickId: string, ref: string, extra: { status?: "PENDING" | "FLAGGED" | "VOIDED" } = {}) {
  return createCommissionUnlessSelfReferral({
    data: {
      affiliateId,
      clickId,
      paymentRef: ref,
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

  it("queues nothing while the product has email off", async () => {
    const merchant = await seedMerchant((await seedOwner()).id);
    const { program, affiliate, click } = await seedReferral(merchant);
    await createAffiliate(merchant.id, program.id, { name: "Alice", email: "alice@example.com", passwordHash: "x" });
    await sale(affiliate.id, click.id, "in_1");

    expect(await db.email.count()).toBe(0);
  });

  it("tells the owner who joined, and welcomes the affiliate with their link and terms", async () => {
    const { owner, merchant } = await productWithMail();
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

  it("follows the product's switches", async () => {
    const { merchant } = await productWithMail({ notifyNewAffiliates: false });
    const { program } = await seedReferral(merchant);
    await createAffiliate(merchant.id, program.id, { name: "Alice", email: "alice@example.com", passwordHash: "x" });

    expect(await keys()).toEqual(["welcome"]);
  });

  it("announces a referred customer's first sale to both, and not the renewals after it", async () => {
    const { merchant } = await productWithMail();
    const { affiliate, click } = await seedReferral(merchant);
    await sale(affiliate.id, click.id, "in_1");
    await sale(affiliate.id, click.id, "in_2");

    const emails = await db.email.findMany({ orderBy: { dedupeKey: "asc" } });
    expect(emails.map((e) => e.dedupeKey.split(":")[0])).toEqual(["earned", "sale"]);
    expect(emails[0].subject).toBe("You earned $9.00");
    expect(emails[1].subject).toMatch(/^New sale from /);
    expect(emails[1].text).toContain("brought a $30.00 sale");
  });

  it("sends a flagged sale to the owner alone, even with sale emails off, and a voided one to nobody", async () => {
    const { merchant } = await productWithMail({ notifyNewSales: false });
    const flagged = await seedReferral(merchant);
    await sale(flagged.affiliate.id, flagged.click.id, "in_1", { status: "FLAGGED" });
    const voided = await seedReferral(merchant);
    await sale(voided.affiliate.id, voided.click.id, "in_2", { status: "VOIDED" });

    expect(await keys()).toEqual(["flagged"]);
  });

  it("sends one email for a payout, with its total", async () => {
    const { merchant } = await productWithMail({ notifyNewSales: false });
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

  it("emails a password link that leaves the owner's copied one working", async () => {
    const { merchant } = await productWithMail({ emailAffiliates: false });
    const { affiliate } = await seedReferral(merchant);
    await createAffiliateResetLink(merchant.ownerId, merchant.id, affiliate.id);

    expect(await emailPasswordLink(affiliate.id)).toBe(true);

    expect(await db.affiliateLoginToken.count({ where: { affiliateId: affiliate.id, usedAt: null } })).toBe(2);
    const [email] = await db.email.findMany();
    expect(email.text).toMatch(/\/affiliates\/password\?token=[0-9a-f]{64}/);
    expect(email.text).toContain("within 1 hour");
  });

  it("never queues an email to a list of addresses", async () => {
    const { owner, merchant } = await productWithMail();
    const { program } = await seedReferral(merchant);
    await createAffiliate(merchant.id, program.id, { name: "Eve", email: "eve@example.com, a@victim.test", passwordHash: "x" });

    expect((await db.email.findMany()).map((e) => e.to)).toEqual([owner.email]);
  });

  it("refuses a password link while email is off", async () => {
    const merchant = await seedMerchant((await seedOwner()).id);
    const { affiliate } = await seedReferral(merchant);

    expect(await emailPasswordLink(affiliate.id)).toBe(false);
    expect(await db.affiliateLoginToken.count()).toBe(0);
  });
});
