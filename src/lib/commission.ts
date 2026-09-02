import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

async function assertMerchantOwnership(ownerId: string, merchantId: string): Promise<void> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { id: true },
  });
  if (!merchant) {
    throw new Error("Merchant not found");
  }
}

export type CommissionStatus = "PENDING" | "PAYABLE" | "PAID" | "VOIDED" | "FLAGGED";

export const COMMISSION_STATUSES: readonly CommissionStatus[] = [
  "PENDING",
  "PAYABLE",
  "FLAGGED",
  "PAID",
  "VOIDED",
];

export type CommissionFilters = {
  /** Null means every status. */
  status: CommissionStatus | null;
  affiliateId: string | null;
  currency: string | null;
  /** Matches a Stripe payment reference, or an affiliate's name or email. */
  query: string | null;
};

export type CommissionRow = {
  id: string;
  amount: string;
  currency: string;
  status: CommissionStatus;
  createdAt: Date;
  payableAt: Date;
  paidAt: Date | null;
  flagReason: string | null;
  voidReason: string | null;
  stripePaymentRef: string | null;
  affiliateId: string;
  affiliateName: string | null;
  affiliateEmail: string;
  /** A negative clawback row for a refund that landed after payout. */
  isAdjustment: boolean;
};

export const COMMISSIONS_PAGE_SIZE = 25;

function whereFor(merchantId: string, filters: CommissionFilters) {
  const query = filters.query?.trim();

  return {
    affiliate: {
      merchantId,
      ...(filters.affiliateId ? { id: filters.affiliateId } : {}),
    },
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.currency ? { currency: filters.currency } : {}),
    ...(query
      ? {
          OR: [
            { stripePaymentRef: { contains: query, mode: "insensitive" as const } },
            { affiliate: { merchantId, email: { contains: query, mode: "insensitive" as const } } },
            { affiliate: { merchantId, name: { contains: query, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
}

/**
 * One ledger for every commission, whatever state it is in.
 *
 * There is no separate payable view and no separate flagged view. Splitting
 * them meant a commission the Owner had just been told about was invisible
 * until its Holding Period expired, and it took two paginated screens to
 * answer "what does this affiliate have outstanding".
 */
export async function listCommissions(
  ownerId: string,
  merchantId: string,
  filters: CommissionFilters,
  { page, pageSize }: { page: number; pageSize: number }
): Promise<{ rows: CommissionRow[]; total: number }> {
  await assertMerchantOwnership(ownerId, merchantId);

  const where = whereFor(merchantId, filters);

  const [total, rows] = await Promise.all([
    db.commission.count({ where }),
    db.commission.findMany({
      where,
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        createdAt: true,
        payableAt: true,
        paidAt: true,
        flagReason: true,
        voidReason: true,
        stripePaymentRef: true,
        adjustsCommissionId: true,
        affiliate: { select: { id: true, name: true, email: true } },
      },
      // Newest first: the ledger is read to find out what just happened far
      // more often than to audit the beginning of time.
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    total,
    rows: rows.map((c) => ({
      id: c.id,
      amount: c.amount.toFixed(2),
      currency: c.currency,
      status: c.status as CommissionStatus,
      createdAt: c.createdAt,
      payableAt: c.payableAt,
      paidAt: c.paidAt,
      flagReason: c.flagReason,
      voidReason: c.voidReason,
      stripePaymentRef: c.stripePaymentRef,
      affiliateId: c.affiliate.id,
      affiliateName: c.affiliate.name,
      affiliateEmail: c.affiliate.email,
      isAdjustment: c.adjustsCommissionId !== null,
    })),
  };
}

export type StatusTotal = {
  status: CommissionStatus;
  count: number;
  /** One entry per currency, since amounts are never converted. */
  amounts: { currency: string; total: string }[];
};

/**
 * Count and money per status, across the whole Merchant.
 *
 * Deliberately not filtered by the current view: these double as the status
 * filter, so they have to say what is there, not what is showing.
 */
export async function getCommissionTotals(
  ownerId: string,
  merchantId: string
): Promise<StatusTotal[]> {
  await assertMerchantOwnership(ownerId, merchantId);

  const grouped = await db.commission.groupBy({
    by: ["status", "currency"],
    where: { affiliate: { merchantId } },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return COMMISSION_STATUSES.map((status) => {
    const forStatus = grouped.filter((g) => g.status === status);
    return {
      status,
      count: forStatus.reduce((sum, g) => sum + g._count._all, 0),
      amounts: forStatus
        .map((g) => ({
          currency: g.currency,
          total: (g._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
        }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
    };
  });
}

/** Everything the filter bar offers, drawn from what this Merchant actually has. */
export async function getCommissionFilterOptions(
  ownerId: string,
  merchantId: string
): Promise<{
  affiliates: { id: string; name: string | null; email: string }[];
  currencies: string[];
}> {
  await assertMerchantOwnership(ownerId, merchantId);

  const [affiliates, currencies] = await Promise.all([
    db.affiliate.findMany({
      where: { merchantId, commissions: { some: {} } },
      select: { id: true, name: true, email: true },
      orderBy: { email: "asc" },
    }),
    db.commission.groupBy({
      by: ["currency"],
      where: { affiliate: { merchantId } },
      orderBy: { currency: "asc" },
    }),
  ]);

  return { affiliates, currencies: currencies.map((c) => c.currency) };
}

export type MarkPaidResult = { count: number } | { error: string };

/**
 * Mark an exact set of commissions paid.
 *
 * Bound to the ids the Owner selected, never to a re-query at write time: a
 * commission crossing its Holding Period between render and click would
 * otherwise be swept into a payout nobody decided to make, and PAID is a
 * terminal state (VOIDED is only reachable from PENDING, PAYABLE or FLAGGED).
 *
 * Two refusals guard the refund-adjustment rule. A payout is per affiliate per
 * currency, so a selection spanning more than one of either is not a payout.
 * And a negative clawback row sitting PAYABLE in the same group has to go out
 * with the selection, otherwise marking only the positive rows paid would
 * quietly erase money the Affiliate still owes back instead of carrying it
 * forward. Both are checks that refuse, not sweeps that widen the write.
 */
export async function markCommissionsPaid(
  ownerId: string,
  merchantId: string,
  commissionIds: string[]
): Promise<MarkPaidResult> {
  await assertMerchantOwnership(ownerId, merchantId);

  if (commissionIds.length === 0) {
    return { error: "Nothing selected" };
  }

  const selected = await db.commission.findMany({
    where: { id: { in: commissionIds }, status: "PAYABLE", affiliate: { merchantId } },
    select: { id: true, affiliateId: true, currency: true, amount: true },
  });

  if (selected.length !== commissionIds.length) {
    return { error: "Some of those commissions are no longer payable. Reload and try again." };
  }

  const affiliateIds = new Set(selected.map((c) => c.affiliateId));
  const currencies = new Set(selected.map((c) => c.currency));
  if (affiliateIds.size > 1 || currencies.size > 1) {
    return { error: "A payout covers one affiliate and one currency at a time" };
  }

  const [affiliateId] = [...affiliateIds];
  const [currency] = [...currencies];

  const outstandingClawback = await db.commission.findFirst({
    where: {
      status: "PAYABLE",
      currency,
      affiliateId,
      amount: { lt: 0 },
      id: { notIn: commissionIds },
    },
    select: { id: true },
  });
  if (outstandingClawback) {
    return {
      error: "This affiliate has a refund adjustment outstanding. Include it in the payout.",
    };
  }

  const total = selected.reduce((sum, c) => sum.add(c.amount), new Prisma.Decimal(0));
  if (total.lessThan(0)) {
    return { error: "That selection owes money back. It carries to the next payout." };
  }

  const { count } = await db.commission.updateMany({
    where: {
      status: "PAYABLE",
      currency,
      affiliate: { id: affiliateId, merchantId },
      id: { in: commissionIds },
    },
    data: { status: "PAID", paidAt: new Date() },
  });

  return { count };
}

export async function confirmCommissionFraud(
  ownerId: string,
  merchantId: string,
  commissionId: string
): Promise<void> {
  await assertMerchantOwnership(ownerId, merchantId);

  const existing = await db.commission.findFirst({
    where: { id: commissionId, status: "FLAGGED", affiliate: { merchantId } },
    select: { id: true },
  });
  if (!existing) {
    throw new Error("Flagged commission not found");
  }

  await db.commission.update({
    where: { id: commissionId },
    data: { status: "VOIDED", voidedAt: new Date(), voidReason: "confirmed self-referral" },
  });
}

export async function dismissCommissionFlag(
  ownerId: string,
  merchantId: string,
  commissionId: string
): Promise<void> {
  await assertMerchantOwnership(ownerId, merchantId);

  const existing = await db.commission.findFirst({
    where: { id: commissionId, status: "FLAGGED", affiliate: { merchantId } },
    select: { id: true, payableAt: true },
  });
  if (!existing) {
    throw new Error("Flagged commission not found");
  }

  const newStatus = existing.payableAt <= new Date() ? "PAYABLE" : "PENDING";

  await db.commission.update({
    where: { id: commissionId },
    data: { status: newStatus, flagReason: null },
  });
}
