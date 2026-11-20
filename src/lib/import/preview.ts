import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { importRef } from "./apply";
import type { FetchedProgram, ImportSourceKey } from "./types";

export type ImportPreview = {
  campaigns: { id: string; name: string; affiliates: number }[];
  affiliates: number;
  /** Already in this product under the same email: kept as they are. */
  existingEmails: number;
  /** Used by another product: those affiliates get a new code. */
  codesTaken: string[];
  referrals: number;
  /** Referrals whose renewals can keep earning here. */
  renewalsLinkable: number;
  owed: { currency: string; total: string; count: number }[];
  paid: { currency: string; total: string; count: number }[];
  /** Brought over by an earlier run. */
  alreadyImported: number;
};

function totals(rows: { currency: string; amount: string }[]) {
  const by = new Map<string, { total: Prisma.Decimal; count: number }>();
  for (const row of rows) {
    const current = by.get(row.currency) ?? { total: new Prisma.Decimal(0), count: 0 };
    by.set(row.currency, { total: current.total.add(row.amount), count: current.count + 1 });
  }
  return [...by].map(([currency, t]) => ({ currency, total: t.total.toFixed(2), count: t.count }));
}

/** What an import would do to this product, read without writing anything. */
export async function previewImport(
  merchant: { id: string; paymentProvider: string },
  source: ImportSourceKey,
  fetched: FetchedProgram
): Promise<ImportPreview> {
  const emails = fetched.affiliates.map((a) => a.email.trim().toLowerCase());
  const codes = [...new Set(fetched.affiliates.flatMap((a) => a.codes.map((c) => c.trim())))];
  const refs = fetched.commissions.map((c) => importRef(source, "commission", c.id));

  const [existing, links, retired, imported] = await Promise.all([
    db.affiliate.findMany({ where: { merchantId: merchant.id, email: { in: emails } }, select: { email: true } }),
    db.affiliateLink.findMany({ where: { code: { in: codes } }, select: { code: true, affiliate: { select: { merchantId: true, email: true } } } }),
    db.retiredLinkCode.findMany({ where: { code: { in: codes } }, select: { code: true, merchantId: true } }),
    db.commission.count({ where: { merchantId: merchant.id, paymentRef: { in: refs } } }),
  ]);

  // A code is free when nobody has it, or when this product's affiliate with
  // the same email already does.
  const emailOfCode = new Map<string, string>();
  for (const a of fetched.affiliates) for (const c of a.codes) emailOfCode.set(c.trim(), a.email.trim().toLowerCase());
  const codesTaken = [
    ...links
      .filter((l) => l.affiliate.merchantId !== merchant.id || l.affiliate.email !== emailOfCode.get(l.code))
      .map((l) => l.code),
    ...retired.filter((r) => r.merchantId !== merchant.id).map((r) => r.code),
  ];

  const live = fetched.commissions.filter((c) => c.state !== "void" && Number(c.amount) > 0);
  return {
    campaigns: fetched.campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      affiliates: fetched.affiliates.filter((a) => a.campaignId === c.id).length,
    })),
    affiliates: new Set(emails).size,
    existingEmails: existing.length,
    codesTaken: [...new Set(codesTaken)].sort(),
    referrals: fetched.referrals.length,
    renewalsLinkable: fetched.referrals.filter(
      (r) => r.subscriptionId || (r.stripeCustomerId && merchant.paymentProvider === "STRIPE")
    ).length,
    owed: totals(live.filter((c) => c.state !== "paid")),
    paid: totals(live.filter((c) => c.state === "paid")),
    alreadyImported: imported,
  };
}
