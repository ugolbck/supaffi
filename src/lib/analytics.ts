import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

/**
 * Every aggregate the dashboard cards read.
 *
 * One file because they all share the same two problems: a date window that
 * has to be zero-filled so a chart cannot draw holes as if they were data, and
 * money that is bucketed per currency because Supaffi never converts (see
 * CONTEXT.md).
 *
 * Every function here is Owner-scoped in its own query rather than trusting
 * the route that called it, same rule as merchant.ts and commission.ts.
 */

export type DayPoint = {
  /**
   * Start of the bucket, in UTC. A calendar day as YYYY-MM-DD, an hour as a
   * full ISO stamp, a month as its first day. The chart reads the bucket
   * from `ProductMetrics.bucket`, not from the shape of this string.
   */
  date: string;
  clicks: number;
  conversions: number;
  /**
   * Chart-only sum of sale amounts. It adds across currencies on purpose,
   * because a bar chart needs one number per day, so it must never be shown
   * as money anywhere. The labelled total is `ProductMetrics.revenue`, which
   * stays bucketed per currency.
   */
  revenue: number;
  signups: number;
  /**
   * Money in the bucket, per currency, in major units.
   *
   * `gross` is what customers paid for the Owner, and what the Affiliate
   * earned for the Affiliate. `commission` is what the Owner owes on it, and
   * is what lets one bar show both the sale and its cost.
   *
   * Kept per currency and never added across them: Supaffi does not convert,
   * so a total spanning two currencies is not a number. The chart draws one
   * currency, named in `chartCurrency`, and the tooltip lists the rest.
   */
  amounts: Record<string, Amounts>;
};
export type CurrencyTotal = { currency: string; total: string };
export type Amounts = { gross: number; commission: number; sales: number };

/**
 * The windows the dashboards offer, and how finely each one is cut. Hours
 * for a single day, days for anything up to a month, months beyond that.
 * "all" starts where the product does and picks days or months by how long
 * that has been.
 */
export type ChartRange =
  | "today"
  | "yesterday"
  | "this-week"
  | "7d"
  | "this-month"
  | "30d"
  | "12m"
  | "all";
export type Bucket = "hour" | "day" | "month";

export const CHART_RANGES: { id: ChartRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "this-week", label: "This week" },
  { id: "7d", label: "Last 7 days" },
  { id: "this-month", label: "This month" },
  { id: "30d", label: "Last 30 days" },
  { id: "12m", label: "Last 12 months" },
  { id: "all", label: "All time" },
];

export const DEFAULT_RANGE: ChartRange = "30d";

export function isChartRange(value: unknown): value is ChartRange {
  return CHART_RANGES.some((r) => r.id === value);
}

/** The range a page was asked for, or the default when the URL says nothing usable. */
export function rangeFromQuery(value: string | string[] | undefined): ChartRange {
  return isChartRange(value) ? value : DEFAULT_RANGE;
}

/** The label a header prints for the window, e.g. "Last 30 days". */
export function rangeLabel(range: ChartRange): string {
  return CHART_RANGES.find((r) => r.id === range)!.label;
}

export type Window = { since: Date; until: Date; bucket: Bucket };

/**
 * A window in UTC, from a range name. `startedAt` is where "all" begins:
 * the product's or the affiliate's own creation. Everything ends at `now`,
 * so today's chart stops at the current hour rather than drawing empty
 * hours that have not happened.
 */
export function resolveRange(range: ChartRange | number, now: Date, startedAt: Date): Window {
  const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const today = day(now);
  const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000);
  if (typeof range === "number") {
    return { since: daysAgo(range - 1), until: now, bucket: "day" };
  }
  switch (range) {
    case "today":
      return { since: today, until: now, bucket: "hour" };
    case "yesterday": {
      const start = daysAgo(1);
      return { since: start, until: new Date(today.getTime() - 1), bucket: "hour" };
    }
    case "this-week": {
      // Monday, as the week starts everywhere Supaffi is likely to be run.
      const offset = (today.getUTCDay() + 6) % 7;
      return { since: daysAgo(offset), until: now, bucket: "day" };
    }
    case "7d":
      return { since: daysAgo(6), until: now, bucket: "day" };
    case "this-month":
      return { since: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), until: now, bucket: "day" };
    case "30d":
      return { since: daysAgo(29), until: now, bucket: "day" };
    case "12m":
      return {
        since: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)),
        until: now,
        bucket: "month",
      };
    case "all": {
      const start = day(startedAt < now ? startedAt : now);
      const span = (today.getTime() - start.getTime()) / 86_400_000;
      // Under two months of history is still a story in days. Beyond that,
      // sixty-plus daily bars in a card read as noise, so it turns to months.
      return span < 60
        ? { since: start, until: now, bucket: "day" }
        : { since: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)), until: now, bucket: "month" };
    }
  }
}

/** The key a moment falls under, for the bucket in use. */
export function bucketKey(date: Date, bucket: Bucket): string {
  const iso = date.toISOString();
  if (bucket === "hour") return `${iso.slice(0, 13)}:00:00.000Z`;
  if (bucket === "day") return iso.slice(0, 10);
  return `${iso.slice(0, 7)}-01`;
}

function nextBucket(date: Date, bucket: Bucket): Date {
  const next = new Date(date);
  if (bucket === "hour") next.setUTCHours(next.getUTCHours() + 1);
  else if (bucket === "day") next.setUTCDate(next.getUTCDate() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

async function assertOwns(ownerId: string, merchantId: string): Promise<void> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { id: true },
  });
  if (!merchant) {
    throw new Error("Merchant not found");
  }
}

/** Exported for `listAffiliatePayments` in affiliate.ts, which buckets `paidAt`
 * by the same UTC day the rest of this file uses. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Every bucket in the window, in order, with zeros where nothing happened.
 *
 * Built from a pre-seeded map rather than from the rows, because a chart drawn
 * straight from grouped rows silently closes its gaps and turns three quiet
 * days into one steep line.
 */
function emptySeries(window: Window): Map<string, DayPoint> {
  const series = new Map<string, DayPoint>();
  let cursor = new Date(bucketKey(window.since, window.bucket));
  while (cursor <= window.until) {
    const key = bucketKey(cursor, window.bucket);
    series.set(key, { date: key, clicks: 0, conversions: 0, revenue: 0, signups: 0, amounts: {} });
    cursor = nextBucket(cursor, window.bucket);
  }
  return series;
}

function addAmount(point: DayPoint, currency: string, gross: number, commission: number): void {
  const entry = point.amounts[currency] ?? { gross: 0, commission: 0, sales: 0 };
  point.amounts[currency] = {
    gross: Math.round((entry.gross + gross) * 100) / 100,
    commission: Math.round((entry.commission + commission) * 100) / 100,
    sales: entry.sales + 1,
  };
}

/**
 * The currencies in the window, the one a chart should open on first.
 *
 * Ranked by how many sales were made in each, never by the total. A total
 * ranks by the size of the unit: one sale of 8,000 rupees outranks fifty of
 * 100 dollars, and the chart would open on the currency the merchant barely
 * trades in, with every dollar day a stub beside it. Counting sales asks the
 * question that was meant: which currency is this business actually in.
 *
 * Empty when nothing was sold, which is a chart of clicks and no bars.
 */
export function currenciesByUse(series: DayPoint[]): string[] {
  const sales = new Map<string, number>();
  for (const point of series) {
    for (const [currency, amounts] of Object.entries(point.amounts)) {
      sales.set(currency, (sales.get(currency) ?? 0) + amounts.sales);
    }
  }
  return [...sales.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([currency]) => currency);
}

/** The one to open on, or null when nothing has sold. */
export function pickCurrency(present: string[], requested: string | undefined): string | null {
  if (requested && present.includes(requested)) return requested;
  return present[0] ?? null;
}

function totalsByCurrency(
  rows: { currency: string; _sum: { amount: Prisma.Decimal | null } }[]
): CurrencyTotal[] {
  return rows
    .map((row) => ({
      currency: row.currency,
      total: (row._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export type ProductMetrics = {
  clicks: number;
  conversions: number;
  /** Percent with one decimal. Zero, never NaN, when nothing has been clicked. */
  conversionRate: number;
  /** PENDING plus PAYABLE: money the Owner still has to hand over. */
  owed: CurrencyTotal[];
  paid: CurrencyTotal[];
  /** What customers paid on attributed sales in the window, by currency. Unknown for commissions older than the column. */
  revenue: CurrencyTotal[];
  /** Affiliates who joined in the window. */
  signups: number;
  /** Commissions held back for review, all time. Drives the Owner's to-do list. */
  flagged: number;
  series: DayPoint[];
  /** How finely `series` is cut, so the chart labels it right. */
  bucket: Bucket;
  /** Every currency sold in, most sales first. Empty when nothing sold. */
  currencies: string[];
};

export async function getProductMetrics(
  ownerId: string,
  merchantId: string,
  range: ChartRange | number = DEFAULT_RANGE
): Promise<ProductMetrics> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { createdAt: true },
  });
  if (!merchant) throw new Error("Merchant not found");

  const window = resolveRange(range, new Date(), merchant.createdAt);
  const since = window.since;

  const [clickRows, commissionRows, owedRows, paidRows, revenueRows, signupRows, flagged] =
    await Promise.all([
      db.click.findMany({
        where: { affiliate: { merchantId }, createdAt: { gte: since, lte: window.until } },
        select: { createdAt: true },
      }),
      db.commission.findMany({
        where: {
          affiliate: { merchantId },
          createdAt: { gte: since, lte: window.until },
          // A void is a refund or a caught self referral: it brought in
          // nothing and costs nothing. An adjustment is the negative row
          // that corrects another sale, not a sale of its own. Counting
          // either put a bar on the chart with no money in it.
          status: { not: "VOIDED" },
          adjustsCommissionId: null,
        },
        select: { createdAt: true, saleAmount: true, amount: true, currency: true },
      }),
      db.commission.groupBy({
        by: ["currency"],
        where: { affiliate: { merchantId }, status: { in: ["PENDING", "PAYABLE"] } },
        _sum: { amount: true },
      }),
      db.commission.groupBy({
        by: ["currency"],
        where: { affiliate: { merchantId }, status: "PAID" },
        _sum: { amount: true },
      }),
      db.commission.groupBy({
        by: ["currency"],
        where: {
          affiliate: { merchantId },
          createdAt: { gte: since, lte: window.until },
          saleAmount: { not: null },
          status: { not: "VOIDED" },
          adjustsCommissionId: null,
        },
        _sum: { saleAmount: true },
      }),
      db.affiliate.findMany({
        where: { merchantId, createdAt: { gte: since, lte: window.until } },
        select: { createdAt: true },
      }),
      // Not windowed: a flagged commission stays the Owner's problem however
      // long it has sat there.
      db.commission.count({ where: { affiliate: { merchantId }, status: "FLAGGED" } }),
    ]);

  const series = emptySeries(window);
  const key = (d: Date) => bucketKey(d, window.bucket);
  for (const click of clickRows) {
    const point = series.get(key(click.createdAt));
    if (point) point.clicks += 1;
  }
  for (const commission of commissionRows) {
    const point = series.get(key(commission.createdAt));
    if (!point) continue;
    point.conversions += 1;
    point.revenue += Number(commission.saleAmount ?? 0);
    addAmount(
      point,
      commission.currency,
      Number(commission.saleAmount ?? 0),
      commission.amount.toNumber()
    );
  }
  for (const affiliate of signupRows) {
    const point = series.get(key(affiliate.createdAt));
    if (point) point.signups += 1;
  }

  const clicks = clickRows.length;
  const conversions = commissionRows.length;

  return {
    clicks,
    conversions,
    conversionRate: clicks === 0 ? 0 : Math.round((conversions / clicks) * 1000) / 10,
    owed: totalsByCurrency(owedRows),
    paid: totalsByCurrency(paidRows),
    revenue: totalsByCurrency(
      revenueRows.map((row) => ({ currency: row.currency, _sum: { amount: row._sum.saleAmount } }))
    ),
    signups: signupRows.length,
    flagged,
    series: [...series.values()],
    bucket: window.bucket,
    currencies: currenciesByUse([...series.values()]),
  };
}

/**
 * Daily points rolled up into weekly totals, oldest first.
 *
 * A card at rail width cannot read 84 individual bars, so a day-level series
 * gets bucketed before it reaches a chart. Two things are deliberate, not
 * accidental:
 *
 * - When `daily.length` is not a multiple of 7, the last bucket is whatever
 *   is left over (fewer than 7 days), not dropped and not folded into the
 *   previous week. A partial week still happened; silently discarding it or
 *   merging its total into a neighbour would misreport that neighbour's
 *   volume.
 * - A week made entirely of zero-filled days still produces its own zero
 *   bucket rather than being omitted. `emptySeries` zero-fills for exactly
 *   this reason: a chart that skips quiet days lies about the shape.
 */
export function toWeeks(daily: DayPoint[]): DayPoint[] {
  const weeks: DayPoint[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    weeks.push({
      date: chunk[0].date,
      clicks: chunk.reduce((sum, d) => sum + d.clicks, 0),
      conversions: chunk.reduce((sum, d) => sum + d.conversions, 0),
      revenue: chunk.reduce((sum, d) => sum + d.revenue, 0),
      signups: chunk.reduce((sum, d) => sum + d.signups, 0),
      amounts: chunk.reduce<Record<string, Amounts>>((acc, d) => {
        for (const [currency, amounts] of Object.entries(d.amounts)) {
          const entry = acc[currency] ?? { gross: 0, commission: 0, sales: 0 };
          acc[currency] = {
            gross: Math.round((entry.gross + amounts.gross) * 100) / 100,
            commission: Math.round((entry.commission + amounts.commission) * 100) / 100,
            sales: entry.sales + amounts.sales,
          };
        }
        return acc;
      }, {}),
    });
  }
  return weeks;
}

export type TopAffiliate = {
  id: string;
  name: string | null;
  email: string;
  clicks: number;
  earned: CurrencyTotal[];
  /**
   * Sales behind `earned`. Refund adjustments are negative rows pointing at
   * the commission they correct, so counting every commission row would read
   * one refunded sale as two sales.
   */
  sales: number;
};

export async function getTopAffiliates(
  ownerId: string,
  merchantId: string,
  limit = 5
): Promise<TopAffiliate[]> {
  await assertOwns(ownerId, merchantId);

  // Ranked by money earned, not by clicks. Clicks are effort; this list is
  // about who is actually working.
  const earned = await db.commission.groupBy({
    by: ["affiliateId", "currency"],
    where: { affiliate: { merchantId }, status: { notIn: ["VOIDED"] } },
    _sum: { amount: true },
  });
  if (earned.length === 0) return [];

  const byAffiliate = new Map<string, { total: number; earned: CurrencyTotal[] }>();
  for (const row of earned) {
    const amount = row._sum.amount ?? new Prisma.Decimal(0);
    const existing = byAffiliate.get(row.affiliateId) ?? { total: 0, earned: [] };
    existing.total += amount.toNumber();
    existing.earned.push({ currency: row.currency, total: amount.toFixed(2) });
    byAffiliate.set(row.affiliateId, existing);
  }

  const ranked = [...byAffiliate.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, limit);

  const rankedIds = ranked.map(([id]) => id);
  const [affiliates, clicks, sales] = await Promise.all([
    db.affiliate.findMany({
      where: { id: { in: rankedIds } },
      select: { id: true, name: true, email: true },
    }),
    db.click.groupBy({
      by: ["affiliateId"],
      where: { affiliateId: { in: rankedIds } },
      _count: { _all: true },
    }),
    // Same scope as `earned`, minus the rows that are not a sale: adjustments
    // carry the commission they correct, and a zero or negative amount is a
    // correction rather than something somebody bought.
    db.commission.groupBy({
      by: ["affiliateId"],
      where: {
        affiliateId: { in: rankedIds },
        status: { notIn: ["VOIDED"] },
        adjustsCommissionId: null,
        amount: { gt: 0 },
      },
      _count: { _all: true },
    }),
  ]);
  const affiliateById = new Map(affiliates.map((a) => [a.id, a]));
  const clicksById = new Map(clicks.map((c) => [c.affiliateId, c._count._all]));
  const salesById = new Map(sales.map((s) => [s.affiliateId, s._count._all]));

  return ranked.map(([id, totals]) => {
    const affiliate = affiliateById.get(id)!;
    return {
      id,
      name: affiliate.name,
      email: affiliate.email,
      clicks: clicksById.get(id) ?? 0,
      earned: totals.earned.sort((a, b) => a.currency.localeCompare(b.currency)),
      sales: salesById.get(id) ?? 0,
    };
  });
}

export type PayableGroup = {
  affiliateId: string;
  affiliateName: string | null;
  affiliateEmail: string;
  currency: string;
  total: string;
  commissionIds: string[];
};

/**
 * What is ready to pay, per affiliate per currency.
 *
 * Carries the exact commission ids behind each total so the Pay button can
 * name them, rather than the mutation re-querying at write time and sweeping
 * in whatever turned payable in between (CONTEXT.md).
 */
export async function getPayableGroups(
  ownerId: string,
  merchantId: string
): Promise<PayableGroup[]> {
  await assertOwns(ownerId, merchantId);

  const rows = await db.commission.findMany({
    where: { status: "PAYABLE", affiliate: { merchantId } },
    select: {
      id: true,
      amount: true,
      currency: true,
      affiliate: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map<string, PayableGroup & { sum: Prisma.Decimal }>();
  for (const row of rows) {
    const key = `${row.affiliate.id}:${row.currency}`;
    const existing = groups.get(key);
    if (existing) {
      existing.sum = existing.sum.add(row.amount);
      existing.commissionIds.push(row.id);
    } else {
      groups.set(key, {
        affiliateId: row.affiliate.id,
        affiliateName: row.affiliate.name,
        affiliateEmail: row.affiliate.email,
        currency: row.currency,
        total: "0.00",
        commissionIds: [row.id],
        sum: row.amount,
      });
    }
  }

  return [...groups.values()]
    .map(({ sum, ...group }) => ({ ...group, total: sum.toFixed(2) }))
    .sort((a, b) => Number(b.total) - Number(a.total));
}

export type WebhookHealth = {
  lastEventAt: Date | null;
  last24h: number;
  recent: { id: string; type: string; status: string; at: Date }[];
};

export async function getWebhookHealth(
  ownerId: string,
  merchantId: string
): Promise<WebhookHealth> {
  await assertOwns(ownerId, merchantId);

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [last24h, recent] = await Promise.all([
    db.webhookEvent.count({ where: { merchantId, createdAt: { gte: dayAgo } } }),
    db.webhookEvent.findMany({
      where: { merchantId },
      select: { id: true, payload: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  return {
    lastEventAt: recent[0]?.createdAt ?? null,
    last24h,
    recent: recent.map((event) => ({
      id: event.id,
      // The stored payload is the Stripe event itself. Falls back rather than
      // throwing, since a malformed payload is a debugging aid, not a crash.
      type:
        (event.payload as { type?: unknown } | null)?.type?.toString() ?? "unknown event",
      status: event.status,
      at: event.createdAt,
    })),
  };
}

export type AffiliateMetrics = {
  clicks: number;
  conversions: number;
  /** Percent with one decimal. Zero, never NaN, when nothing has been clicked. */
  conversionRate: number;
  /** PENDING plus PAYABLE: money the Affiliate is owed but has not been sent. */
  unpaid: CurrencyTotal[];
  pending: CurrencyTotal[];
  payable: CurrencyTotal[];
  paid: CurrencyTotal[];
  series: DayPoint[];
  bucket: Bucket;
  /** Every currency earned in, most commissions first. */
  currencies: string[];
};

/**
 * The affiliate's own numbers, shaped like getProductMetrics so both
 * dashboards read the same.
 *
 * No ownership assertion: an Affiliate id comes from their own session and
 * every query below is already scoped by it. There is no id to escape to.
 */
export async function getAffiliateMetrics(
  affiliateId: string,
  range: ChartRange | number = DEFAULT_RANGE
): Promise<AffiliateMetrics> {
  const affiliate = await db.affiliate.findUnique({
    where: { id: affiliateId },
    select: { createdAt: true },
  });
  const window = resolveRange(range, new Date(), affiliate?.createdAt ?? new Date());
  const since = window.since;

  const [clickRows, commissionRows, statusRows] = await Promise.all([
    db.click.findMany({
      where: { affiliateId, createdAt: { gte: since, lte: window.until } },
      select: { createdAt: true },
    }),
    db.commission.findMany({
      where: {
        affiliateId,
        createdAt: { gte: since, lte: window.until },
        // Same rule as the Owner's: a void earned nothing, and an adjustment
        // corrects a sale rather than being one.
        status: { not: "VOIDED" },
        adjustsCommissionId: null,
      },
      select: { createdAt: true, amount: true, currency: true },
    }),
    db.commission.groupBy({
      by: ["currency", "status"],
      where: { affiliateId },
      _sum: { amount: true },
    }),
  ]);

  const series = emptySeries(window);
  const key = (d: Date) => bucketKey(d, window.bucket);
  for (const click of clickRows) {
    const point = series.get(key(click.createdAt));
    if (point) point.clicks += 1;
  }
  for (const commission of commissionRows) {
    const point = series.get(key(commission.createdAt));
    if (!point) continue;
    point.conversions += 1;
    const amount = commission.amount.toNumber();
    addAmount(point, commission.currency, amount, amount);
  }

  // statusRows is grouped by currency AND status, so folding e.g. PENDING and
  // PAYABLE into one "unpaid" bucket can produce two rows for the same
  // currency. totalsByCurrency does not merge duplicates, so they are summed
  // here first, with Prisma.Decimal rather than JS floats since this is money.
  const rowsFor = (statuses: readonly string[]) => {
    const byCurrency = new Map<string, Prisma.Decimal>();
    for (const row of statusRows) {
      if (!statuses.includes(row.status)) continue;
      const amount = row._sum.amount ?? new Prisma.Decimal(0);
      byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? new Prisma.Decimal(0)).add(amount));
    }
    return [...byCurrency.entries()].map(([currency, amount]) => ({
      currency,
      _sum: { amount },
    }));
  };

  const clicks = clickRows.length;
  const conversions = commissionRows.length;

  return {
    clicks,
    conversions,
    conversionRate: clicks === 0 ? 0 : Math.round((conversions / clicks) * 1000) / 10,
    // FLAGGED sits with PENDING, matching toDisplayStatus: an Affiliate is
    // never shown a fraud check the Merchant has not finished reviewing.
    pending: totalsByCurrency(rowsFor(["PENDING", "FLAGGED"])),
    payable: totalsByCurrency(rowsFor(["PAYABLE"])),
    unpaid: totalsByCurrency(rowsFor(["PENDING", "FLAGGED", "PAYABLE"])),
    paid: totalsByCurrency(rowsFor(["PAID"])),
    series: [...series.values()],
    bucket: window.bucket,
    currencies: currenciesByUse([...series.values()]),
  };
}
