// Destructive: clears Commission / Payout / Click / AffiliateLink / Affiliate /
// Program / Merchant / Owner. Runs against the scratch DATABASE_URL that
// test/setup.ts enforces, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";

const MIGRATION = "prisma/migrations/20261120090000_payouts/migration.sql";

// Only the backfill: the table and columns it fills already exist here.
const BACKFILL = readFileSync(MIGRATION, "utf8")
  .split(";")
  .map((statement) => statement.trim())
  .filter((statement) => /^(INSERT INTO "Payout"|UPDATE "Commission")/m.test(statement.replace(/^--.*$/gm, "").trim()));

async function clearAll() {
  await db.commission.deleteMany();
  await db.payout.deleteMany();
  await db.click.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

describe("payouts migration", () => {
  beforeEach(clearAll);
  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("turns each set of commissions paid together into one payout, and links them", async () => {
    expect(BACKFILL).toHaveLength(2);
    const owner = await db.owner.create({ data: { email: `owner-${crypto.randomUUID()}@example.com`, passwordHash: "x" } });
    const merchant = await db.merchant.create({
      data: { slug: "m", ownerId: owner.id, name: "M", domain: `${crypto.randomUUID()}.example.com`, websiteUrl: "https://m.example.com" },
    });
    const program = await db.program.create({
      data: {
        slug: "p",
        merchantId: merchant.id,
        name: "Standard",
        defaultCommissionRate: 20,
        commissionDurationType: "FOREVER",
        attributionWindowDays: 60,
        holdingPeriodDays: 30,
      },
    });
    const affiliate = await db.affiliate.create({
      data: { merchantId: merchant.id, programId: program.id, email: "a@example.com" },
    });
    const click = await db.click.create({
      data: { affiliateId: affiliate.id, programId: program.id, referralToken: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
    });
    const base = { merchantId: merchant.id, affiliateId: affiliate.id, clickId: click.id, payableAt: new Date() };
    const first = new Date("2026-09-01T09:00:00Z");
    const second = new Date("2026-10-01T09:00:00Z");
    const paid = (amount: string, currency: string, paidAt: Date) =>
      db.commission.create({ data: { ...base, amount, currency, status: "PAID", paidAt, paymentRef: crypto.randomUUID() } });
    const a = await paid("10.00", "usd", first);
    const b = await paid("5.50", "usd", first);
    const c = await paid("7.00", "eur", first);
    const d = await paid("3.00", "usd", second);
    const unpaid = await db.commission.create({ data: { ...base, amount: "9.00", currency: "usd", status: "PAYABLE", paymentRef: "x" } });

    for (const statement of BACKFILL) await db.$executeRawUnsafe(statement);

    const payouts = await db.payout.findMany({ include: { commissions: { select: { id: true } } }, orderBy: [{ paidAt: "asc" }, { currency: "asc" }] });
    expect(payouts.map((p) => [p.currency, p.amount.toFixed(2), p.paidAt, p.commissions.map((x) => x.id).sort()])).toEqual([
      ["eur", "7.00", first, [c.id]],
      ["usd", "15.50", first, [a.id, b.id].sort()],
      ["usd", "3.00", second, [d.id]],
    ]);
    expect(payouts.every((p) => p.method === null && p.reference === null && p.merchantId === merchant.id)).toBe(true);
    expect((await db.commission.findUniqueOrThrow({ where: { id: unpaid.id } })).payoutId).toBeNull();
  });
});
