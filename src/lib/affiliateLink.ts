import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { CurrencyTotal } from "@/lib/analytics";
import { REFERRAL_QUERY_PARAM } from "@/lib/referral";

export type AffiliateLinkRow = {
  id: string;
  code: string;
  destinationPath: string | null;
  isPrimary: boolean;
};

/**
 * The link created at signup.
 *
 * Every Affiliate has exactly one, it cannot be deleted, and it is the code the
 * Merchant's own dashboard shows. Returns null only for an Affiliate id that
 * does not exist, which callers already treat as "log in again".
 */
export async function getPrimaryLink(affiliateId: string): Promise<AffiliateLinkRow | null> {
  const link = await db.affiliateLink.findFirst({
    where: { affiliateId, isPrimary: true },
    select: { id: true, code: true, destinationPath: true, isPrimary: true },
  });
  return link ?? null;
}

/** Every link an Affiliate has, primary first, then oldest first. */
export async function listLinks(affiliateId: string): Promise<AffiliateLinkRow[]> {
  return db.affiliateLink.findMany({
    where: { affiliateId },
    select: { id: true, code: true, destinationPath: true, isPrimary: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
}

/**
 * A ceiling, not a product rule. Links are free to create and each one is a
 * globally unique code, so an unbounded allowance is a way to exhaust the code
 * space for everyone else on the instance.
 */
export const MAX_LINKS_PER_AFFILIATE = 20;

const CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type LinkInput = { code: string; destinationPath: string };

// Shaped like validateSignupInput: both arms carry `error`, so a plain
// `error !== null` check narrows the union without a cast.
export type ValidatedLink = { code: string; destinationPath: string | null; error: null };

/**
 * The code goes straight into a public URL and the destination is rendered as
 * one, so both are checked here rather than trusted from the form.
 */
export function validateLinkInput(
  input: LinkInput
): ValidatedLink | { code?: undefined; destinationPath?: undefined; error: string } {
  const code = input.code.trim().toLowerCase();
  if (code.length < 2 || code.length > 30) {
    return { error: "A code is between 2 and 30 characters." };
  }
  if (!CODE_PATTERN.test(code)) {
    return { error: "Use lowercase letters, numbers and hyphens, with no hyphen at either end." };
  }

  const raw = input.destinationPath.trim();
  if (raw === "") return { code, destinationPath: null, error: null };

  // A destination is a path on the Merchant's own site. Anything that could
  // read as an absolute or protocol-relative URL would send the Affiliate's
  // traffic somewhere else entirely.
  if (!raw.startsWith("/") || raw.startsWith("//")) {
    return { error: "A destination starts with / and points at a page on the site." };
  }
  if (raw.includes("://") || /\s/.test(raw)) {
    return { error: "A destination cannot contain spaces or a full web address." };
  }
  if (raw.length > 200) {
    return { error: "That destination is too long." };
  }

  return { code, destinationPath: raw, error: null };
}

/** The URL an Affiliate actually shares. */
export function linkUrl(
  websiteUrl: string,
  link: { code: string; destinationPath: string | null }
): string {
  const base = websiteUrl.replace(/\/+$/, "");
  const path = link.destinationPath ?? "";
  return `${base}${path}?${REFERRAL_QUERY_PARAM}=${link.code}`;
}

export async function createLink(
  affiliateId: string,
  input: LinkInput
): Promise<{ error: string } | { id: string }> {
  const validated = validateLinkInput(input);
  if (validated.error !== null) return { error: validated.error };
  const { code, destinationPath } = validated;

  const count = await db.affiliateLink.count({ where: { affiliateId } });
  if (count >= MAX_LINKS_PER_AFFILIATE) {
    return {
      error: `You can have up to ${MAX_LINKS_PER_AFFILIATE} links. Delete one to add another.`,
    };
  }

  try {
    const created = await db.affiliateLink.create({
      data: { affiliateId, code, destinationPath, isPrimary: false },
      select: { id: true },
    });
    return { id: created.id };
  } catch (err) {
    // Checking first and inserting second would still race, so the constraint
    // is what actually decides and this is where the answer is read.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "That code is already taken. Try another." };
    }
    throw err;
  }
}

export async function updateLink(
  affiliateId: string,
  linkId: string,
  input: LinkInput
): Promise<{ error: string } | { ok: true }> {
  const validated = validateLinkInput(input);
  if (validated.error !== null) return { error: validated.error };
  const { code, destinationPath } = validated;

  // Scoped by affiliateId, so one Affiliate cannot rename another's link into
  // their own. updateMany rather than update: a where clause on two columns
  // cannot use the unique-by-id form.
  try {
    const result = await db.affiliateLink.updateMany({
      where: { id: linkId, affiliateId },
      data: { code, destinationPath },
    });
    if (result.count === 0) return { error: "That link no longer exists." };
    return { ok: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "That code is already taken. Try another." };
    }
    throw err;
  }
}

export async function deleteLink(
  affiliateId: string,
  linkId: string
): Promise<{ error: string } | { ok: true }> {
  const link = await db.affiliateLink.findFirst({
    where: { id: linkId, affiliateId },
    select: { isPrimary: true },
  });
  if (!link) return { error: "That link no longer exists." };
  if (link.isPrimary) return { error: "Your signup link cannot be deleted." };

  // Click.linkId is ON DELETE SET NULL, so the clicks and every Commission
  // behind them survive. Only the per-link attribution is lost, which is the
  // honest outcome: the link is gone.
  await db.affiliateLink.delete({ where: { id: linkId } });
  return { ok: true };
}

export type AffiliateLinkStats = AffiliateLinkRow & {
  clicks: number;
  conversions: number;
  earned: CurrencyTotal[];
};

/**
 * Every link with what it has produced. Earnings exclude VOIDED: a refunded
 * sale is not something the Affiliate earned, and showing it would inflate
 * every link's total permanently.
 */
export async function listLinksWithStats(affiliateId: string): Promise<AffiliateLinkStats[]> {
  const links = await listLinks(affiliateId);
  if (links.length === 0) return [];
  const ids = links.map((l) => l.id);

  const [clickGroups, commissionRows] = await Promise.all([
    db.click.groupBy({ by: ["linkId"], where: { linkId: { in: ids } }, _count: { _all: true } }),
    db.commission.findMany({
      where: { click: { linkId: { in: ids } }, status: { not: "VOIDED" } },
      select: { amount: true, currency: true, click: { select: { linkId: true } } },
    }),
  ]);

  const clicksByLink = new Map(clickGroups.map((g) => [g.linkId, g._count._all]));
  const totals = new Map<string, Map<string, Prisma.Decimal>>();
  const conversions = new Map<string, number>();
  for (const row of commissionRows) {
    const linkId = row.click.linkId;
    if (!linkId) continue;
    conversions.set(linkId, (conversions.get(linkId) ?? 0) + 1);
    const byCurrency = totals.get(linkId) ?? new Map<string, Prisma.Decimal>();
    byCurrency.set(
      row.currency,
      (byCurrency.get(row.currency) ?? new Prisma.Decimal(0)).add(row.amount)
    );
    totals.set(linkId, byCurrency);
  }

  return links.map((link) => ({
    ...link,
    clicks: clicksByLink.get(link.id) ?? 0,
    conversions: conversions.get(link.id) ?? 0,
    earned: [...(totals.get(link.id) ?? new Map())]
      .map(([currency, total]) => ({ currency, total: total.toFixed(2) }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
  }));
}
