import { db } from "@/lib/db";
import { generateReferralCode } from "@/lib/referralCode";
import { Prisma } from "@prisma/client";

export type CreateAffiliateInput = { name: string; email: string };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createAffiliate(
  merchantId: string,
  programId: string,
  input: CreateAffiliateInput
): Promise<{ id: string; email: string; referralCode: string }> {
  const email = normalizeEmail(input.email);
  const referralCode = await generateReferralCode(input.name);

  return db.affiliate.create({
    data: {
      merchantId,
      programId,
      email,
      name: input.name,
      referralCode,
    },
    select: { id: true, email: true, referralCode: true },
  });
}

export async function getAffiliateByEmail(
  merchantId: string,
  email: string
): Promise<{ id: string; email: string; referralCode: string } | null> {
  return db.affiliate.findUnique({
    where: { merchantId_email: { merchantId, email: normalizeEmail(email) } },
    select: { id: true, email: true, referralCode: true },
  });
}

export async function getAffiliateSession(
  affiliateId: string
): Promise<{ referralCode: string; merchantWebsiteUrl: string; merchantId: string } | null> {
  const affiliate = await db.affiliate.findUnique({
    where: { id: affiliateId },
    select: { referralCode: true, merchant: { select: { id: true, websiteUrl: true } } },
  });
  if (!affiliate) return null;
  return {
    referralCode: affiliate.referralCode,
    merchantWebsiteUrl: affiliate.merchant.websiteUrl,
    merchantId: affiliate.merchant.id,
  };
}

export type AffiliateCommissionStatus = "PENDING" | "PAYABLE" | "PAID" | "VOIDED";

const AFFILIATE_VISIBLE_STATUSES: readonly string[] = ["PENDING", "PAYABLE", "PAID", "VOIDED"];

export function toDisplayStatus(status: string): AffiliateCommissionStatus {
  return AFFILIATE_VISIBLE_STATUSES.includes(status)
    ? (status as AffiliateCommissionStatus)
    : "PENDING";
}

export type AffiliateStatusTotal = {
  currency: string;
  status: AffiliateCommissionStatus;
  amount: string;
};

export type AffiliateStats = {
  totalClicks: number;
  totals: AffiliateStatusTotal[];
};

export async function getAffiliateStats(affiliateId: string): Promise<AffiliateStats> {
  const [totalClicks, grouped] = await Promise.all([
    db.click.count({ where: { affiliateId } }),
    db.commission.groupBy({
      by: ["currency", "status"],
      where: { affiliateId },
      _sum: { amount: true },
    }),
  ]);

  const merged = new Map<string, Prisma.Decimal>();
  for (const g of grouped) {
    const status = toDisplayStatus(g.status);
    const key = `${g.currency}:${status}`;
    const amount = g._sum.amount ?? new Prisma.Decimal(0);
    merged.set(key, (merged.get(key) ?? new Prisma.Decimal(0)).add(amount));
  }

  const totals: AffiliateStatusTotal[] = [...merged.entries()].map(([key, amount]) => {
    const [currency, status] = key.split(":");
    return { currency, status: status as AffiliateCommissionStatus, amount: amount.toFixed(2) };
  });

  return { totalClicks, totals };
}

export type AffiliateCommissionRow = {
  id: string;
  amount: string;
  currency: string;
  status: AffiliateCommissionStatus;
  createdAt: Date;
  payableAt: Date;
  paidAt: Date | null;
};

export async function listAffiliateCommissions(
  affiliateId: string,
  { page, pageSize }: { page: number; pageSize: number }
): Promise<{ rows: AffiliateCommissionRow[]; total: number }> {
  const where = { affiliateId };
  const [rows, total] = await Promise.all([
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
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.commission.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      currency: r.currency,
      createdAt: r.createdAt,
      payableAt: r.payableAt,
      paidAt: r.paidAt,
      amount: r.amount.toFixed(2),
      status: toDisplayStatus(r.status),
    })),
  };
}

export async function updateAffiliatePayoutDetails(
  affiliateId: string,
  payoutDetails: string
): Promise<void> {
  const trimmed = payoutDetails.trim();
  await db.affiliate.update({
    where: { id: affiliateId },
    data: { payoutDetails: trimmed || null },
  });
}

export async function getAffiliatePayoutDetails(affiliateId: string): Promise<string | null> {
  const affiliate = await db.affiliate.findUnique({
    where: { id: affiliateId },
    select: { payoutDetails: true },
  });
  return affiliate?.payoutDetails ?? null;
}
