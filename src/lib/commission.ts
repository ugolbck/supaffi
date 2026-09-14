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
  /** A refund adjustment row an older version wrote. None are written any more. */
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

/** One commission as a page showed it: its id and its amount as rendered, two decimals. */
export type ShownCommission = { id: string; amount: string };

export type MarkPaidResult = { count: number; skipped: number } | { error: string };

/** The refusal for bound input no page could have produced. */
const REFUSED = "The ledger refused that payout.";

/** Every amount a page renders is `Decimal.toFixed(2)` of a positive commission. */
const TWO_DECIMALS = /^\d+\.\d{2}$/;

/** No page renders anywhere near this many rows in one payout. */
const MAX_SHOWN = 5000;

/** The voids a refund or a lost chargeback writes, as opposed to the Owner's own. */
const REFUND_VOID_REASONS: readonly string[] = ["refund", "chargeback"];

type PayoutRow = {
  status: CommissionStatus;
  amount: Prisma.Decimal;
  grossAmount: Prisma.Decimal | null;
  voidedAt: Date | null;
  voidReason: string | null;
  adjustsCommissionId: string | null;
};

type Payout = "as stored" | "at shown amount" | "already paid" | "skip";

/**
 * What one shown commission becomes when Mark paid is pressed.
 *
 * The Owner pays outside Supaffi and then presses the button, so the figure
 * on screen is the figure that left their account, and a paid commission is
 * final. A refund that reached a shown row in the seconds between loading and
 * clicking therefore does not stop it being recorded at the amount shown.
 *
 * A partial refund leaves the row PAYABLE at an amount below the one shown. A
 * page only ever shows a figure above the stored one when the refund came
 * after rendering, because a reduction before rendering is what it would have
 * shown. A full refund or a lost chargeback voids the row with a `voidedAt`
 * later than the moment the page was rendered.
 *
 * Neither is ever recorded above what the commission was worth before any
 * refund, `grossAmount`, or `amount` on rows older than that column, so a
 * posted figure can never raise what a sale earned.
 *
 * A row the Owner voided, or a confirmed self referral voided, is skipped:
 * nobody paid it by mistake, the Owner chose not to. So is anything else that
 * is not payable, and any leftover adjustment row, since a refund after payout
 * is no longer recovered.
 */
function payoutFor(row: PayoutRow, shown: Prisma.Decimal, renderedAt: Date): Payout {
  if (row.status === "PAID") return "already paid";
  if (row.adjustsCommissionId !== null) return "skip";
  if (shown.gt(row.grossAmount ?? row.amount)) return "skip";

  if (row.status === "PAYABLE") {
    if (shown.eq(row.amount)) return "as stored";
    if (shown.gt(row.amount) && row.voidReason === "partial refund") return "at shown amount";
    return "skip";
  }

  if (
    row.status === "VOIDED" &&
    row.voidReason !== null &&
    REFUND_VOID_REASONS.includes(row.voidReason) &&
    row.voidedAt !== null &&
    row.voidedAt.getTime() >= renderedAt.getTime()
  ) {
    return "at shown amount";
  }
  return "skip";
}

/**
 * Mark exactly the commissions the Owner saw paid, at the amounts they saw.
 *
 * Bound to the rows a page rendered, never to a re-query at write time: a
 * commission crossing its Holding Period between render and click would
 * otherwise be swept into a payout nobody decided to make. New sales that land
 * meanwhile stay unpaid.
 *
 * Refuses only what is not a payout: nothing selected, rows spanning more than
 * one affiliate or currency, and bound input no page could have produced. Rows
 * that are no longer payable for a reason the Owner chose are skipped and
 * counted, so the page can say so; see `payoutFor`.
 */
export async function markCommissionsPaid(
  ownerId: string,
  merchantId: string,
  shown: ShownCommission[],
  renderedAt: string
): Promise<MarkPaidResult> {
  await assertMerchantOwnership(ownerId, merchantId);

  if (!Array.isArray(shown) || shown.length === 0) {
    return { error: "Nothing selected" };
  }
  // No page renders anywhere near this many rows in one payout; a request
  // this large is not a payout a page produced.
  if (shown.length > MAX_SHOWN) {
    return { error: REFUSED };
  }

  // Bound arguments are values the browser posts, so their shape is checked
  // rather than trusted: a page names every id once, at a positive two-decimal
  // amount, and was rendered no later than now.
  const amounts = new Map<string, Prisma.Decimal>();
  for (const entry of shown) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.id !== "string" ||
      entry.id.length === 0 ||
      typeof entry.amount !== "string" ||
      !TWO_DECIMALS.test(entry.amount) ||
      amounts.has(entry.id)
    ) {
      return { error: REFUSED };
    }
    const amount = new Prisma.Decimal(entry.amount);
    if (amount.lte(0)) return { error: REFUSED };
    amounts.set(entry.id, amount);
  }
  const loadedAt = typeof renderedAt === "string" ? new Date(renderedAt) : new Date(NaN);
  if (Number.isNaN(loadedAt.getTime()) || loadedAt.getTime() > Date.now()) {
    return { error: REFUSED };
  }

  const ids = [...amounts.keys()];
  const paidAt = new Date();

  return db.$transaction(async (tx): Promise<MarkPaidResult> => {
    // Locks the shown rows for the length of the payout, in id order so two
    // overlapping presses cannot deadlock. A refund, a void or a self referral
    // confirmation on one of them waits for this to commit, then finds the row
    // PAID and leaves it alone, so what is decided below is what stays written.
    // Scoped to this merchant's affiliates, so a foreign id never locks
    // another merchant's row before the ownership check below refuses it.
    await tx.$queryRaw`SELECT id FROM "Commission" WHERE id IN (${Prisma.join(ids)}) AND "affiliateId" IN (SELECT id FROM "Affiliate" WHERE "merchantId" = ${merchantId}) ORDER BY id FOR UPDATE`;

    const rows = await tx.commission.findMany({
      where: { id: { in: ids }, affiliate: { merchantId } },
      select: {
        id: true,
        affiliateId: true,
        currency: true,
        status: true,
        amount: true,
        grossAmount: true,
        voidedAt: true,
        voidReason: true,
        adjustsCommissionId: true,
      },
    });
    // An id this product does not have was not on its page.
    if (rows.length !== ids.length) return { error: REFUSED };

    if (new Set(rows.map((row) => row.affiliateId)).size > 1 || new Set(rows.map((row) => row.currency)).size > 1) {
      return { error: "A payout covers one affiliate and one currency at a time" };
    }

    const asStored: string[] = [];
    const atShownAmount: { id: string; amount: Prisma.Decimal; ceiling: Prisma.Decimal }[] = [];
    let skipped = 0;
    for (const row of rows) {
      const amount = amounts.get(row.id)!;
      const payout = payoutFor(row, amount, loadedAt);
      if (payout === "as stored") asStored.push(row.id);
      else if (payout === "at shown amount") atShownAmount.push({ id: row.id, amount, ceiling: row.grossAmount ?? row.amount });
      else if (payout === "skip") skipped += 1;
    }

    // One write for the usual case, so a payout of many rows stays well inside
    // the transaction's time limit.
    if (asStored.length > 0) {
      await tx.commission.updateMany({
        where: { id: { in: asStored } },
        data: { status: "PAID", paidAt },
      });
    }
    // The few a refund reached in between are written one by one, each at its
    // shown amount. The row is paid, so it no longer reads as voided, and it
    // says it was reduced only if what was paid is still below the gross.
    for (const row of atShownAmount) {
      await tx.commission.update({
        where: { id: row.id },
        data: {
          status: "PAID",
          paidAt,
          amount: row.amount,
          voidedAt: null,
          voidReason: row.amount.lt(row.ceiling) ? "partial refund" : null,
        },
      });
    }

    return { count: asStored.length + atShownAmount.length, skipped };
  });
}

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
    // commissions stay paid: a paid commission is final. Adjustment rows are
    // left out, they are not commissions this referral earned.
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

// The reasons the worker and `confirmCommissionFraud` write verbatim, never
// typed by an Owner. Compared case-insensitively: an Owner typing the same
// words is still the Owner's own decision, not the automatic void those
// literals otherwise mean to `payoutFor` and `voidReasonText`.
const SYSTEM_VOID_REASONS: readonly string[] = [
  "refund",
  "chargeback",
  "partial refund",
  "confirmed self-referral",
];

/**
 * Cancel a commission the Owner has decided not to pay, with a reason.
 *
 * PAID is terminal: a paid commission is final, whether the Owner or a later
 * refund would change it. Voiding twice is refused for the same reason it is
 * refused elsewhere, so a double submit cannot overwrite the reason the first
 * one recorded.
 *
 * An adjustment row is refused outright. None are written any more, and the
 * few an older version left unpaid are voided by a migration.
 *
 * A typed reason that happens to match one of the worker's own words is
 * suffixed before it is stored. Without that, `payoutFor` reads an Owner's
 * void of "refund" as the refund void a stale Mark paid is allowed to record
 * over, which would silently overturn the Owner's decision.
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

  const stored = SYSTEM_VOID_REASONS.includes(reason.trim().toLowerCase())
    ? `${reason} (by owner)`
    : reason;

  // Conditional on the same statuses as the read, so a commission paid out
  // in the moment between the two is refused rather than voided after the
  // money left.
  const { count } = await db.commission.updateMany({
    where: { id: commissionId, status: { in: ["PENDING", "PAYABLE", "FLAGGED"] } },
    data: { status: "VOIDED", voidedAt: new Date(), voidReason: stored },
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
