// Destructive: clears Commission / Click / AffiliateLink / Affiliate / Program /
// Merchant / Owner. Runs against the scratch DATABASE_URL, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";

import { db } from "@/lib/db";
import {
  createAffiliate,
  getAffiliateCommissionTotals,
  listAffiliateCommissions,
  listAffiliatePayments,
} from "@/lib/affiliate";
import { getPrimaryLink } from "@/lib/affiliateLink";
import { getAffiliateMetrics } from "@/lib/analytics";
import { markCommissionsPaid } from "@/lib/commission";

const hasDatabase = Boolean(process.env.DATABASE_URL);

async function clearAll() {
  await db.commission.deleteMany();
  await db.referredSubscription.deleteMany();
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

/** Noon UTC, `n` days ago: far from any day or window boundary. */
function noonDaysAgo(n: number): Date {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - n);
  return date;
}

/** A paid sale and the clawback a later refund wrote against it. */
async function seedClawedBackSale(saleDaysAgo: number, clawbackDaysAgo: number) {
  const { merchant, program } = await seedProgram();
  const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
  const primary = await getPrimaryLink(sarah.id);
  const click = await db.click.create({
    data: {
      affiliateId: sarah.id,
      linkId: primary!.id,
      referralToken: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 86400_000),
    },
  });
  const sale = await db.commission.create({
    data: {
      affiliateId: sarah.id,
      clickId: click.id,
      amount: "30.00",
      currency: "usd",
      status: "PAID",
      payableAt: noonDaysAgo(saleDaysAgo),
      paidAt: noonDaysAgo(saleDaysAgo),
      createdAt: noonDaysAgo(saleDaysAgo),
      stripePaymentRef: crypto.randomUUID(),
    },
  });
  await db.commission.create({
    data: {
      affiliateId: sarah.id,
      clickId: click.id,
      adjustsCommissionId: sale.id,
      amount: "-10.00",
      currency: "usd",
      status: "PAYABLE",
      payableAt: noonDaysAgo(clawbackDaysAgo),
      createdAt: noonDaysAgo(clawbackDaysAgo),
    },
  });
  return sarah;
}

afterAll(clearAll);

describe.skipIf(!hasDatabase)("affiliate metrics", () => {
  beforeEach(clearAll);

  it("takes a clawback off Earned on the day it landed, without counting it as a sale", async () => {
    const sarah = await seedClawedBackSale(5, 1);

    const metrics = await getAffiliateMetrics(sarah.id, 30);

    // 30.00 earned, 10.00 taken back: what they will actually be paid.
    expect(metrics.current.amounts.usd).toEqual({ gross: 20, commission: 20, sales: 1 });
    expect(metrics.conversions).toBe(1);
    const landed = metrics.series.find((p) => p.date === noonDaysAgo(1).toISOString().slice(0, 10));
    expect(landed?.amounts.usd).toEqual({ gross: -10, commission: -10, sales: 0 });
    expect(landed?.conversions).toBe(0);
  });

  it("nets the clawback in the previous period too, so the comparison is like for like", async () => {
    // Both fall in the seven days before the current seven-day window.
    const sarah = await seedClawedBackSale(9, 8);

    const metrics = await getAffiliateMetrics(sarah.id, 7);

    expect(metrics.previous?.amounts.usd).toEqual({ gross: 20, commission: 20, sales: 1 });
    expect(metrics.previous?.conversions).toBe(1);
  });

  it("reports zeros and a full zero-filled series for a brand new affiliate", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });

    const metrics = await getAffiliateMetrics(sarah.id, 30);
    expect(metrics.clicks).toBe(0);
    expect(metrics.conversions).toBe(0);
    // Zero, never NaN: an empty dashboard must not read "NaN%".
    expect(metrics.conversionRate).toBe(0);
    expect(metrics.unpaid).toEqual([]);
    // A chart that skips quiet days lies about the shape, so every day is present.
    expect(metrics.series).toHaveLength(30);
    expect(metrics.series.every((p) => p.clicks === 0 && p.conversions === 0)).toBe(true);
  });

  it("splits unpaid into pending and payable without converting currencies", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const primary = await getPrimaryLink(sarah.id);
    const click = await db.click.create({
      data: {
        affiliateId: sarah.id,
        linkId: primary!.id,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    for (const [status, amount, currency] of [
      ["PENDING", "10.00", "usd"],
      ["PAYABLE", "5.00", "usd"],
      ["PAYABLE", "7.00", "eur"],
      ["PAID", "100.00", "usd"],
      ["VOIDED", "50.00", "usd"],
    ] as const) {
      await db.commission.create({
        data: {
          affiliateId: sarah.id,
          clickId: click.id,
          amount,
          currency,
          status,
          payableAt: new Date(),
          stripePaymentRef: crypto.randomUUID(),
        },
      });
    }

    const metrics = await getAffiliateMetrics(sarah.id, 30);
    expect(metrics.pending).toEqual([{ currency: "usd", total: "10.00" }]);
    expect(metrics.payable).toEqual([
      { currency: "eur", total: "7.00" },
      { currency: "usd", total: "5.00" },
    ]);
    // Summed per currency, never across them.
    expect(metrics.unpaid).toEqual([
      { currency: "eur", total: "7.00" },
      { currency: "usd", total: "15.00" },
    ]);
    expect(metrics.paid).toEqual([{ currency: "usd", total: "100.00" }]);
    expect(metrics.clicks).toBe(1);
    // Four, not five: the voided one earned nothing, so it is not a
    // commission the affiliate has. A chart counting it drew a bar with no
    // money in it, and a tooltip that said "Earned: None" beside a count.
    expect(metrics.conversions).toBe(4);
  });

  it("folds a flagged commission into pending, in the tile counts and in the filtered rows", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const primary = await getPrimaryLink(sarah.id);
    const click = await db.click.create({
      data: {
        affiliateId: sarah.id,
        linkId: primary!.id,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    await db.commission.create({
      data: {
        affiliateId: sarah.id,
        clickId: click.id,
        amount: "9.00",
        currency: "usd",
        status: "FLAGGED",
        flagReason: "card",
        payableAt: new Date(),
        stripePaymentRef: crypto.randomUUID(),
      },
    });
    // A genuinely PENDING row, same currency as the flagged one above. This is
    // what rowsFor (src/lib/analytics.ts) exists to sum: two source rows that
    // both display as PENDING must merge into one summed bucket, not overwrite
    // one another. Without it, the single-flagged-row case above would still
    // pass even if rowsFor overwrote instead of accumulated.
    await db.commission.create({
      data: {
        affiliateId: sarah.id,
        clickId: click.id,
        amount: "4.00",
        currency: "usd",
        status: "PENDING",
        payableAt: new Date(Date.now() + 86400_000),
        stripePaymentRef: crypto.randomUUID(),
      },
    });

    const metrics = await getAffiliateMetrics(sarah.id, 30);
    expect(metrics.pending).toEqual([{ currency: "usd", total: "13.00" }]);

    const totals = await getAffiliateCommissionTotals(sarah.id);
    expect(totals).toEqual([
      { status: "PENDING", count: 2 },
      { status: "PAYABLE", count: 0 },
      { status: "PAID", count: 0 },
      { status: "VOIDED", count: 0 },
    ]);

    const { rows } = await listAffiliateCommissions(sarah.id, { page: 1, pageSize: 10, status: "PENDING" });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "PENDING")).toBe(true);
  });

  it("counts flagged money as unpaid and nets a clawback against it, never below zero", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const primary = await getPrimaryLink(sarah.id);
    const click = await db.click.create({
      data: {
        affiliateId: sarah.id,
        linkId: primary!.id,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    for (const [status, amount, currency] of [
      ["FLAGGED", "9.00", "usd"],
      ["PAYABLE", "-3.00", "usd"],
      ["PAYABLE", "-4.00", "eur"],
    ] as const) {
      await db.commission.create({
        data: { affiliateId: sarah.id, clickId: click.id, amount, currency, status, payableAt: new Date() },
      });
    }

    const metrics = await getAffiliateMetrics(sarah.id, 30);
    // Pending is as earned. Payable is only debt in both currencies, so it
    // shows nothing rather than a negative. Unpaid is 9.00 less the 3.00 owed
    // back in usd, and nothing in eur.
    expect(metrics.pending).toEqual([{ currency: "usd", total: "9.00" }]);
    expect(metrics.payable).toEqual([]);
    expect(metrics.unpaid).toEqual([{ currency: "usd", total: "6.00" }]);
  });

  it("takes a clawback off the payable figure", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const primary = await getPrimaryLink(sarah.id);
    const click = await db.click.create({
      data: {
        affiliateId: sarah.id,
        linkId: primary!.id,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    for (const amount of ["10.00", "-3.00"]) {
      await db.commission.create({
        data: { affiliateId: sarah.id, clickId: click.id, amount, currency: "usd", status: "PAYABLE", payableAt: new Date() },
      });
    }

    const metrics = await getAffiliateMetrics(sarah.id, 30);
    // What the merchant will actually send on the next payout.
    expect(metrics.payable).toEqual([{ currency: "usd", total: "7.00" }]);
    expect(metrics.unpaid).toEqual([{ currency: "usd", total: "7.00" }]);
  });
});

describe.skipIf(!hasDatabase)("listAffiliatePayments", () => {
  beforeEach(clearAll);

  async function seedClick(affiliateId: string) {
    const primary = await getPrimaryLink(affiliateId);
    return db.click.create({
      data: {
        affiliateId,
        linkId: primary!.id,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
  }

  async function payCommission(
    affiliateId: string,
    clickId: string,
    amount: string,
    currency: string,
    paidAt: Date
  ) {
    return db.commission.create({
      data: {
        affiliateId,
        clickId,
        amount,
        currency,
        status: "PAID",
        payableAt: paidAt,
        paidAt,
        stripePaymentRef: crypto.randomUUID(),
      },
    });
  }

  it("keeps two payouts made the same day as two rows, newest first", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const click = await seedClick(sarah.id);
    await payCommission(sarah.id, click.id, "10.00", "usd", new Date("2026-08-15T09:00:00.000Z"));
    await payCommission(sarah.id, click.id, "5.00", "usd", new Date("2026-08-15T18:00:00.000Z"));

    const payments = await listAffiliatePayments(sarah.id);
    expect(payments).toHaveLength(2);
    expect(payments[0].paidAt).toEqual(new Date("2026-08-15T18:00:00.000Z"));
    expect(payments[0].totals).toEqual([{ currency: "usd", total: "5.00" }]);
    expect(payments[1].totals).toEqual([{ currency: "usd", total: "10.00" }]);
  });

  it("collapses the commissions of one payout into one row", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const click = await seedClick(sarah.id);
    const moment = new Date("2026-08-15T09:00:00.000Z");
    await payCommission(sarah.id, click.id, "10.00", "usd", moment);
    await payCommission(sarah.id, click.id, "5.00", "usd", moment);

    const payments = await listAffiliatePayments(sarah.id);
    expect(payments).toHaveLength(1);
    expect(payments[0].count).toBe(2);
    expect(payments[0].totals).toEqual([{ currency: "usd", total: "15.00" }]);
  });

  it("keeps currencies separate within one payout's row rather than summing across them", async () => {
    const { merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const click = await seedClick(sarah.id);
    const moment = new Date("2026-08-15T09:00:00.000Z");
    await payCommission(sarah.id, click.id, "10.00", "usd", moment);
    await payCommission(sarah.id, click.id, "7.00", "eur", moment);

    const payments = await listAffiliatePayments(sarah.id);
    expect(payments).toHaveLength(1);
    expect(payments[0].count).toBe(2);
    expect(payments[0].totals).toEqual([
      { currency: "eur", total: "7.00" },
      { currency: "usd", total: "10.00" },
    ]);
  });

  it("shows each press of Mark paid as its own payment", async () => {
    // Proves the grouping key against the real write: one press stamps one
    // moment on every row it pays, and a second press stamps another.
    const { owner, merchant, program } = await seedProgram();
    const sarah = await createAffiliate(merchant.id, program.id, { name: "Sarah", email: "s@example.com" });
    const click = await seedClick(sarah.id);
    const make = (amount: string) =>
      db.commission.create({
        data: {
          affiliateId: sarah.id,
          clickId: click.id,
          amount,
          currency: "usd",
          status: "PAYABLE",
          payableAt: new Date(Date.now() - 1000),
          stripePaymentRef: crypto.randomUUID(),
        },
      });
    const a = await make("10.00");
    const b = await make("4.00");
    const c = await make("5.00");

    expect(await markCommissionsPaid(owner.id, merchant.id, [a.id, b.id], "14.00")).toEqual({ count: 2 });
    expect(await markCommissionsPaid(owner.id, merchant.id, [c.id], "5.00")).toEqual({ count: 1 });

    const payments = await listAffiliatePayments(sarah.id);
    expect(payments).toHaveLength(2);
    expect(payments.map((p) => p.totals[0].total).sort()).toEqual(["14.00", "5.00"]);
  });
});
