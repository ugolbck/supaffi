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
  voidedAt: Date | null;
  flagReason: string | null;
  voidReason: string | null;
  /** What this commission was before a partial refund reduced it. Null when unchanged. */
  grossAmount: string | null;
  stripePaymentRef: string | null;
  affiliateId: string;
  affiliateName: string | null;
  affiliateEmail: string;
  /** A negative clawback row for a refund that landed after payout. */
  isAdjustment: boolean;
  /** The click this sale was attributed to, and the link it arrived through. */
  click: { at: Date; linkCode: string | null; destinationPath: string | null };
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
        voidedAt: true,
        flagReason: true,
        voidReason: true,
        grossAmount: true,
        stripePaymentRef: true,
        adjustsCommissionId: true,
        affiliate: { select: { id: true, name: true, email: true } },
        click: {
          select: {
            createdAt: true,
            // Nullable: deleting a link leaves its clicks behind, and
            // attribution reads the affiliate, not the link.
            link: { select: { code: true, destinationPath: true } },
          },
        },
      },
      // Newest first: the ledger is read to find out what just happened far
      // more often than to audit the beginning of time. On the payable tab
      // the sales come before the refund adjustments against them, which
      // are recent by nature and otherwise filled the first page.
      orderBy:
        filters.status === "PAYABLE"
          ? [{ adjustsCommissionId: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }]
          : { createdAt: "desc" },
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
      voidedAt: c.voidedAt,
      flagReason: c.flagReason,
      voidReason: c.voidReason,
      grossAmount: c.grossAmount ? c.grossAmount.toFixed(2) : null,
      stripePaymentRef: c.stripePaymentRef,
      affiliateId: c.affiliate.id,
      affiliateName: c.affiliate.name,
      affiliateEmail: c.affiliate.email,
      isAdjustment: c.adjustsCommissionId !== null,
      click: {
        at: c.click.createdAt,
        linkCode: c.click.link?.code ?? null,
        destinationPath: c.click.link?.destinationPath ?? null,
      },
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

/** The refusal for a payout whose amounts moved under the Owner. */
const AMOUNT_CHANGED = "An amount changed since this page loaded. Check the new total before paying.";

/**
 * Mark an exact set of commissions paid.
 *
 * Bound to the ids the Owner selected, never to a re-query at write time: a
 * commission crossing its Holding Period between render and click would
 * otherwise be swept into a payout nobody decided to make, and PAID is a
 * terminal state (VOIDED is only reachable from PENDING, PAYABLE or FLAGGED).
 *
 * Bound to the total the Owner was shown as well. The Owner pays outside
 * Supaffi and then presses the button, so the figure on screen is the figure
 * that left their account. A partial refund can lower an amount in between,
 * and recording the lower figure would leave the ledger short of what was
 * sent with no clawback to recover it. The sum is taken inside the same
 * transaction as the write, so it reads the rows as they are being paid.
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
  commissionIds: string[],
  expectedTotal: string
): Promise<MarkPaidResult> {
  await assertMerchantOwnership(ownerId, merchantId);

  if (commissionIds.length === 0) {
    return { error: "Nothing selected" };
  }

  // Every total a page renders is `Decimal.toFixed(2)`. Anything else did not
  // come from a page, and comparing it would be comparing against a guess.
  if (typeof expectedTotal !== "string" || !/^-?\d+\.\d{2}$/.test(expectedTotal)) {
    return { error: AMOUNT_CHANGED };
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

  // All or nothing. A row can leave PAYABLE between the checks above and this
  // write (a refund voids it), and paying the rest would record a payout that
  // no longer matches what the Owner is about to send. Throwing inside the
  // transaction rolls the partial write back.
  try {
    const count = await db.$transaction(async (tx) => {
      const { count } = await tx.commission.updateMany({
        where: {
          status: "PAYABLE",
          currency,
          affiliate: { id: affiliateId, merchantId },
          id: { in: commissionIds },
        },
        data: { status: "PAID", paidAt: new Date() },
      });
      if (count !== commissionIds.length) throw new StaleSelectionError();

      // Summed after the update, not before it. The update holds these rows,
      // so a refund that commits first is already in this sum, and a refund
      // that arrives later waits, finds the row PAID, and becomes a clawback
      // instead of a silent reduction.
      const { _sum } = await tx.commission.aggregate({
        where: { id: { in: commissionIds } },
        _sum: { amount: true },
      });
      if ((_sum.amount ?? new Prisma.Decimal(0)).toFixed(2) !== expectedTotal) {
        throw new AmountChangedError();
      }
      return count;
    });
    return { count };
  } catch (err) {
    if (err instanceof StaleSelectionError) {
      return { error: "Some of those commissions are no longer payable. Reload and try again." };
    }
    if (err instanceof AmountChangedError) {
      return { error: AMOUNT_CHANGED };
    }
    throw err;
  }
}

class StaleSelectionError extends Error {}
class AmountChangedError extends Error {}

export async function confirmCommissionFraud(
  ownerId: string,
  merchantId: string,
  commissionId: string
): Promise<void> {
  await assertMerchantOwnership(ownerId, merchantId);

  const existing = await db.commission.findFirst({
    where: { id: commissionId, status: "FLAGGED", affiliate: { merchantId } },
    select: { id: true, clickId: true },
  });
  if (!existing) {
    throw new Error("Flagged commission not found");
  }

  const now = new Date();
  const confirmed = { status: "VOIDED" as const, voidedAt: now, voidReason: "confirmed self-referral" };
  await db.$transaction(async (tx) => {
    // The status goes in the write, not just the read above: a refund can void
    // the row in between, and this must not overwrite that reason.
    const { count } = await tx.commission.updateMany({
      where: { id: commissionId, status: "FLAGGED" },
      data: confirmed,
    });
    if (count === 0) {
      throw new Error("Flagged commission not found");
    }

    // The referral was the self referral, not only this one payment, so
    // nothing it earned that has not been paid out yet stands. Paid
    // commissions stay paid: the money has already left, and getting it back
    // is the Owner's call, not a row update. Refund adjustments stay too,
    // they are money the affiliate owes back.
    await tx.commission.updateMany({
      where: {
        clickId: existing.clickId,
        adjustsCommissionId: null,
        status: { in: ["PENDING", "PAYABLE", "FLAGGED"] },
      },
      data: confirmed,
    });

    // Voiding rows alone left the referral earning: the next renewal created
    // a fresh commission. Marking the click stops every later payment it
    // brings. The first confirmation's date is kept.
    await tx.click.updateMany({
      where: { id: existing.clickId, fraudConfirmedAt: null },
      data: { fraudConfirmedAt: now },
    });
  });
}

/**
 * Cancel a commission the Owner has decided not to pay, with a reason.
 *
 * PAID is terminal: money that has already gone out cannot be taken back by
 * editing a row, and a refund arrives as its own negative adjustment instead.
 * Voiding twice is refused for the same reason it is refused elsewhere, so a
 * double submit cannot overwrite the reason the first one recorded.
 *
 * An adjustment row is refused outright. It is a debt, not a payout: the
 * commission it claws back stays PAID, so voiding the clawback would quietly
 * write off money the Affiliate owes back.
 */
export async function voidCommission(
  ownerId: string,
  merchantId: string,
  commissionId: string,
  reason: string
): Promise<void> {
  await assertMerchantOwnership(ownerId, merchantId);

  const existing = await db.commission.findFirst({
    where: {
      id: commissionId,
      status: { in: ["PENDING", "PAYABLE", "FLAGGED"] },
      adjustsCommissionId: null,
      affiliate: { merchantId },
    },
    select: { id: true },
  });
  if (!existing) {
    throw new Error("Commission not found, or already paid, voided, or a refund adjustment");
  }

  // Conditional on the same statuses as the read, so a commission paid out
  // in the moment between the two is refused rather than voided after the
  // money left.
  const { count } = await db.commission.updateMany({
    where: { id: commissionId, status: { in: ["PENDING", "PAYABLE", "FLAGGED"] } },
    data: { status: "VOIDED", voidedAt: new Date(), voidReason: reason },
  });
  if (count === 0) {
    throw new Error("Commission not found, or already paid, voided, or a refund adjustment");
  }
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

  // Still FLAGGED at write time, so a commission a refund voided in between
  // is not brought back to life.
  const { count } = await db.commission.updateMany({
    where: { id: commissionId, status: "FLAGGED" },
    data: { status: newStatus, flagReason: null },
  });
  if (count === 0) {
    throw new Error("Flagged commission not found");
  }
}
