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

export type DayPoint = { date: string; clicks: number; conversions: number };
export type CurrencyTotal = { currency: string; total: string };

const DEFAULT_WINDOW_DAYS = 30;

async function assertOwns(ownerId: string, merchantId: string): Promise<void> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { id: true },
  });
  if (!merchant) {
    throw new Error("Merchant not found");
  }
}

/** Midnight UTC, `days - 1` days ago, so the window includes today. */
function windowStart(days: number): Date {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

/** Exported for `listAffiliatePayments` in affiliate.ts, which buckets `paidAt`
 * by the same UTC day the rest of this file uses. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Every day in the window, in order, with zeros where nothing happened.
 *
 * Built from a pre-seeded map rather than from the rows, because a chart drawn
 * straight from grouped rows silently closes its gaps and turns three quiet
 * days into one steep line.
 */
function emptySeries(days: number): Map<string, DayPoint> {
  const series = new Map<string, DayPoint>();
  const start = windowStart(days);
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    const key = dayKey(day);
    series.set(key, { date: key, clicks: 0, conversions: 0 });
  }
  return series;
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
  /** Commissions held back for review, all time. Drives the Owner's to-do list. */
  flagged: number;
  series: DayPoint[];
};

export async function getProductMetrics(
  ownerId: string,
  merchantId: string,
  days: number = DEFAULT_WINDOW_DAYS
): Promise<ProductMetrics> {
  await assertOwns(ownerId, merchantId);

  const since = windowStart(days);

  const [clickRows, commissionRows, owedRows, paidRows, flagged] = await Promise.all([
    db.click.findMany({
      where: { affiliate: { merchantId }, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    db.commission.findMany({
      where: { affiliate: { merchantId }, createdAt: { gte: since } },
      select: { createdAt: true },
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
    // Not windowed: a flagged commission stays the Owner's problem however
    // long it has sat there.
    db.commission.count({ where: { affiliate: { merchantId }, status: "FLAGGED" } }),
  ]);

  const series = emptySeries(days);
  for (const click of clickRows) {
    const point = series.get(dayKey(click.createdAt));
    if (point) point.clicks += 1;
  }
  for (const commission of commissionRows) {
    const point = series.get(dayKey(commission.createdAt));
    if (point) point.conversions += 1;
  }

  const clicks = clickRows.length;
  const conversions = commissionRows.length;

  return {
    clicks,
    conversions,
    conversionRate: clicks === 0 ? 0 : Math.round((conversions / clicks) * 1000) / 10,
    owed: totalsByCurrency(owedRows),
    paid: totalsByCurrency(paidRows),
    flagged,
    series: [...series.values()],
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

  const [affiliates, clicks] = await Promise.all([
    db.affiliate.findMany({
      where: { id: { in: ranked.map(([id]) => id) } },
      select: { id: true, name: true, email: true },
    }),
    db.click.groupBy({
      by: ["affiliateId"],
      where: { affiliateId: { in: ranked.map(([id]) => id) } },
      _count: { _all: true },
    }),
  ]);
  const affiliateById = new Map(affiliates.map((a) => [a.id, a]));
  const clicksById = new Map(clicks.map((c) => [c.affiliateId, c._count._all]));

  return ranked.map(([id, totals]) => {
    const affiliate = affiliateById.get(id)!;
    return {
      id,
      name: affiliate.name,
      email: affiliate.email,
      clicks: clicksById.get(id) ?? 0,
      earned: totals.earned.sort((a, b) => a.currency.localeCompare(b.currency)),
    };
  });
}

export type ActivityItem = {
  id: string;
  kind: "commission" | "signup";
  at: Date;
  affiliateName: string | null;
  affiliateEmail: string;
  amount: string | null;
  currency: string | null;
};

/**
 * Commissions earned and affiliates joined, interleaved, newest first.
 *
 * Clicks are deliberately left out. On a working product they drown out
 * everything that actually needs reading.
 */
export async function getRecentActivity(
  ownerId: string,
  merchantId: string,
  limit = 12
): Promise<ActivityItem[]> {
  await assertOwns(ownerId, merchantId);

  const [commissions, signups] = await Promise.all([
    db.commission.findMany({
      where: { affiliate: { merchantId } },
      select: {
        id: true,
        amount: true,
        currency: true,
        createdAt: true,
        affiliate: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    db.affiliate.findMany({
      where: { merchantId },
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  const items: ActivityItem[] = [
    ...commissions.map((c) => ({
      id: `commission-${c.id}`,
      kind: "commission" as const,
      at: c.createdAt,
      affiliateName: c.affiliate.name,
      affiliateEmail: c.affiliate.email,
      amount: c.amount.toFixed(2),
      currency: c.currency,
    })),
    ...signups.map((a) => ({
      id: `signup-${a.id}`,
      kind: "signup" as const,
      at: a.createdAt,
      affiliateName: a.name,
      affiliateEmail: a.email,
      amount: null,
      currency: null,
    })),
  ];

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
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

export type OwnerMetrics = {
  products: number;
  affiliates: number;
  clicks: number;
  owed: CurrencyTotal[];
  flagged: number;
  series: DayPoint[];
};

/** The same shape, across every product this Owner has. */
export async function getOwnerMetrics(
  ownerId: string,
  days: number = DEFAULT_WINDOW_DAYS
): Promise<OwnerMetrics> {
  const since = windowStart(days);
  const scope = { affiliate: { merchant: { ownerId } } };

  const [products, affiliates, clickRows, commissionRows, owedRows, flagged] =
    await Promise.all([
      db.merchant.count({ where: { ownerId } }),
      db.affiliate.count({ where: { merchant: { ownerId } } }),
      db.click.findMany({
        where: { ...scope, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      db.commission.findMany({
        where: { ...scope, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      db.commission.groupBy({
        by: ["currency"],
        where: { ...scope, status: { in: ["PENDING", "PAYABLE"] } },
        _sum: { amount: true },
      }),
      db.commission.count({ where: { ...scope, status: "FLAGGED" } }),
    ]);

  const series = emptySeries(days);
  for (const click of clickRows) {
    const point = series.get(dayKey(click.createdAt));
    if (point) point.clicks += 1;
  }
  for (const commission of commissionRows) {
    const point = series.get(dayKey(commission.createdAt));
    if (point) point.conversions += 1;
  }

  return {
    products,
    affiliates,
    clicks: clickRows.length,
    owed: totalsByCurrency(owedRows),
    flagged,
    series: [...series.values()],
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
  days: number = DEFAULT_WINDOW_DAYS
): Promise<AffiliateMetrics> {
  const since = windowStart(days);

  const [clickRows, commissionRows, statusRows] = await Promise.all([
    db.click.findMany({
      where: { affiliateId, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    db.commission.findMany({
      where: { affiliateId, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    db.commission.groupBy({
      by: ["currency", "status"],
      where: { affiliateId },
      _sum: { amount: true },
    }),
  ]);

  const series = emptySeries(days);
  for (const click of clickRows) {
    const point = series.get(dayKey(click.createdAt));
    if (point) point.clicks += 1;
  }
  for (const commission of commissionRows) {
    const point = series.get(dayKey(commission.createdAt));
    if (point) point.conversions += 1;
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
  };
}
