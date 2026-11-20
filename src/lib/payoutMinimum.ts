import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * An affiliate's payable balance in one currency that has not reached their
 * program's minimum payout yet, both as two-decimal strings. The balance
 * carries over until it does.
 */
export type Shortfall = { balance: string; minimum: string };

/** What every payable query counts: the rows a payout button can offer. */
export const OFFERABLE = {
  status: "PAYABLE",
  adjustsCommissionId: null,
  amount: { gt: 0 },
  disputeOpenedAt: null,
} satisfies Prisma.CommissionWhereInput;

export function shortfallKey(affiliateId: string, currency: string): string {
  return `${affiliateId}:${currency}`;
}

/**
 * Every balance below its minimum, keyed by `shortfallKey`. The minimum is the
 * one on the affiliate's current program, applied to each currency on its own:
 * amounts are never converted, so a balance in one currency never helps
 * another reach it. A balance at or above the minimum is not in the map.
 */
export async function payableShortfalls(
  scope: { merchantId: string } | { affiliateId: string }
): Promise<Map<string, Shortfall>> {
  const affiliateWhere =
    "merchantId" in scope ? { merchantId: scope.merchantId } : { id: scope.affiliateId };

  const withMinimum = await db.affiliate.findMany({
    where: { ...affiliateWhere, program: { minimumPayout: { gt: 0 } } },
    select: { id: true, program: { select: { minimumPayout: true } } },
  });
  if (withMinimum.length === 0) return new Map();

  const minimumFor = new Map(withMinimum.map((a) => [a.id, a.program.minimumPayout!]));
  const balances = await db.commission.groupBy({
    by: ["affiliateId", "currency"],
    where: { ...OFFERABLE, affiliateId: { in: [...minimumFor.keys()] } },
    _sum: { amount: true },
  });

  const shortfalls = new Map<string, Shortfall>();
  for (const row of balances) {
    const minimum = minimumFor.get(row.affiliateId)!;
    const balance = row._sum.amount ?? new Prisma.Decimal(0);
    if (balance.lt(minimum)) {
      shortfalls.set(shortfallKey(row.affiliateId, row.currency), {
        balance: balance.toFixed(2),
        minimum: minimum.toFixed(2),
      });
    }
  }
  return shortfalls;
}
