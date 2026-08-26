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

export type PayoutGroup = {
  affiliateId: string;
  affiliateName: string | null;
  affiliateEmail: string;
  currency: string;
  totalAmount: string;
  commissionCount: number;
  commissionIds: string[];
};

export async function listPayableGroups(
  ownerId: string,
  merchantId: string,
  { page, pageSize }: { page: number; pageSize: number }
): Promise<{ groups: PayoutGroup[]; totalGroups: number }> {
  await assertMerchantOwnership(ownerId, merchantId);

  const grouped = await db.commission.groupBy({
    by: ["affiliateId", "currency"],
    where: { status: "PAYABLE", affiliate: { merchantId } },
    _sum: { amount: true },
    _count: { _all: true },
    orderBy: [{ affiliateId: "asc" }, { currency: "asc" }],
  });

  const totalGroups = grouped.length;
  const pageSlice = grouped.slice((page - 1) * pageSize, page * pageSize);

  const affiliateIds = [...new Set(pageSlice.map((g) => g.affiliateId))];
  const affiliates = await db.affiliate.findMany({
    where: { id: { in: affiliateIds } },
    select: { id: true, name: true, email: true },
  });
  const affiliateById = new Map(affiliates.map((a) => [a.id, a]));

  // Fetch exactly the commission ids backing each group on this page, so a
  // later "mark paid" can be bounded to what the Merchant actually saw here
  // (rather than sweeping up anything that becomes PAYABLE afterward).
  const commissionRows =
    pageSlice.length === 0
      ? []
      : await db.commission.findMany({
          where: {
            status: "PAYABLE",
            affiliate: { merchantId },
            OR: pageSlice.map((g) => ({ affiliateId: g.affiliateId, currency: g.currency })),
          },
          select: { id: true, affiliateId: true, currency: true },
        });

  const idsByGroup = new Map<string, string[]>();
  for (const row of commissionRows) {
    const key = `${row.affiliateId}:${row.currency}`;
    const existing = idsByGroup.get(key);
    if (existing) {
      existing.push(row.id);
    } else {
      idsByGroup.set(key, [row.id]);
    }
  }

  const groups: PayoutGroup[] = pageSlice.map((g) => {
    const affiliate = affiliateById.get(g.affiliateId)!;
    return {
      affiliateId: g.affiliateId,
      affiliateName: affiliate.name,
      affiliateEmail: affiliate.email,
      currency: g.currency,
      totalAmount: (g._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      commissionCount: g._count._all,
      commissionIds: idsByGroup.get(`${g.affiliateId}:${g.currency}`) ?? [],
    };
  });

  return { groups, totalGroups };
}

export type PayoutCommissionLine = {
  id: string;
  amount: string;
  currency: string;
  createdAt: Date;
  payableAt: Date;
  stripePaymentRef: string | null;
};

export async function getPayoutGroupDetail(
  ownerId: string,
  merchantId: string,
  affiliateId: string,
  currency: string
): Promise<PayoutCommissionLine[]> {
  await assertMerchantOwnership(ownerId, merchantId);

  const commissions = await db.commission.findMany({
    where: { status: "PAYABLE", currency, affiliate: { id: affiliateId, merchantId } },
    select: {
      id: true,
      amount: true,
      currency: true,
      createdAt: true,
      payableAt: true,
      stripePaymentRef: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return commissions.map((c) => ({ ...c, amount: c.amount.toFixed(2) }));
}

export async function markPayoutGroupPaid(
  ownerId: string,
  merchantId: string,
  affiliateId: string,
  currency: string,
  commissionIds: string[]
): Promise<{ count: number }> {
  await assertMerchantOwnership(ownerId, merchantId);

  return db.commission.updateMany({
    where: {
      status: "PAYABLE",
      currency,
      affiliate: { id: affiliateId, merchantId },
      id: { in: commissionIds },
    },
    data: { status: "PAID", paidAt: new Date() },
  });
}

export type FlaggedCommission = {
  id: string;
  amount: string;
  currency: string;
  flagReason: string | null;
  createdAt: Date;
  affiliateId: string;
  affiliateName: string | null;
  affiliateEmail: string;
  stripePaymentRef: string | null;
};

export async function listFlaggedCommissions(
  ownerId: string,
  merchantId: string,
  { page, pageSize }: { page: number; pageSize: number }
): Promise<{ commissions: FlaggedCommission[]; total: number }> {
  await assertMerchantOwnership(ownerId, merchantId);

  const where = { status: "FLAGGED" as const, affiliate: { merchantId } };

  const [total, rows] = await Promise.all([
    db.commission.count({ where }),
    db.commission.findMany({
      where,
      select: {
        id: true,
        amount: true,
        currency: true,
        flagReason: true,
        createdAt: true,
        stripePaymentRef: true,
        affiliate: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    total,
    commissions: rows.map((c) => ({
      id: c.id,
      amount: c.amount.toFixed(2),
      currency: c.currency,
      flagReason: c.flagReason,
      createdAt: c.createdAt,
      affiliateId: c.affiliate.id,
      affiliateName: c.affiliate.name,
      affiliateEmail: c.affiliate.email,
      stripePaymentRef: c.stripePaymentRef,
    })),
  };
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
