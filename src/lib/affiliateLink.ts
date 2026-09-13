import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { CurrencyTotal } from "@/lib/analytics";
import { REFERRAL_QUERY_PARAM } from "@/lib/referral";
import { validateCode } from "@/lib/linkCode";

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
  const validatedCode = validateCode(input.code);
  if (validatedCode.error !== null) return { error: validatedCode.error };
  const code = validatedCode.code;

  const raw = input.destinationPath.trim();
  if (raw === "") return { code, destinationPath: null, error: null };

  // A destination is a path on the Merchant's own site. Anything that could
  // read as an absolute or protocol-relative URL would send the Affiliate's
  // traffic somewhere else entirely. A backslash is included because browsers
  // normalize it to a slash, so "/\evil.com" resolves as "//evil.com" too.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return { error: "A destination starts with / and points at a page on the site." };
  }
  if (raw.includes("://") || /\s/.test(raw)) {
    return { error: "A destination cannot contain spaces or a full web address." };
  }
  // The referral code is appended as its own query parameter. A query string
  // here would double up into "?a=1?via=code", and a fragment would keep the
  // browser from ever sending it to the server, so the link would silently
  // stop earning.
  if (raw.includes("?") || raw.includes("#")) {
    return { error: "A destination cannot contain a question mark or a hash symbol." };
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

const CODE_TAKEN = "That code is already taken. Try another.";
const LINK_GONE = "That link no longer exists.";

/**
 * How many codes one Affiliate can have retired. Retired codes are held for
 * good and are unique across every Merchant, so without a ceiling renaming a
 * link over and over would let one Affiliate claim any number of names.
 */
export const MAX_RETIRED_CODES_PER_AFFILIATE = 50;
const TOO_MANY_RETIRED = "You have changed or deleted too many links. Contact the program owner.";

/**
 * Whether retiring one more code would pass the ceiling. `reclaimed` is a code
 * this change takes back from the Affiliate's own retired ones, which frees a
 * place. Locks the Affiliate row first, so parallel renames count one at a time.
 */
async function retiredCodesFull(
  tx: Prisma.TransactionClient,
  affiliateId: string,
  reclaimed: string | null
): Promise<boolean> {
  await tx.$queryRaw`SELECT "id" FROM "Affiliate" WHERE "id" = ${affiliateId} FOR UPDATE`;
  const count = await tx.retiredLinkCode.count({
    where: { affiliateId, ...(reclaimed ? { code: { not: reclaimed } } : {}) },
  });
  return count >= MAX_RETIRED_CODES_PER_AFFILIATE;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Serializes everything that claims or retires these codes until the
 * transaction ends. Without it, a signup can check that a code is not retired
 * while a rename is retiring it, and both commit. Locks are taken in sorted
 * order so two renames swapping codes cannot deadlock.
 */
export async function lockLinkCodes(tx: Prisma.TransactionClient, codes: string[]): Promise<void> {
  for (const code of [...new Set(codes)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`link-code:${code}`}, 0))`;
  }
}

/**
 * Whether a code was retired by an Affiliate other than this one. Pass null
 * for an Affiliate that does not exist yet, to whom every retired code is off
 * limits.
 */
export async function isCodeRetiredByAnother(
  tx: Prisma.TransactionClient,
  code: string,
  affiliateId: string | null
): Promise<boolean> {
  const retired = await tx.retiredLinkCode.findUnique({
    where: { code },
    select: { affiliateId: true },
  });
  return retired !== null && retired.affiliateId !== affiliateId;
}

async function retireCode(
  tx: Prisma.TransactionClient,
  code: string,
  affiliateId: string,
  merchantId: string
): Promise<void> {
  const retiredAt = new Date();
  await tx.retiredLinkCode.upsert({
    where: { code },
    create: { code, affiliateId, merchantId, retiredAt },
    update: { affiliateId, merchantId, retiredAt },
  });
}

export async function createLink(
  affiliateId: string,
  input: LinkInput
): Promise<{ error: string } | { id: string }> {
  const validated = validateLinkInput(input);
  if (validated.error !== null) return { error: validated.error };
  const { code, destinationPath } = validated;

  try {
    return await db.$transaction(async (tx) => {
      // Locks the Affiliate row first, so parallel requests count one at a
      // time. A count followed by a separate insert let a burst of them all
      // see room for one more and all insert.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Affiliate" WHERE "id" = ${affiliateId} FOR UPDATE`;
      if (locked.length === 0) return { error: LINK_GONE };

      const count = await tx.affiliateLink.count({ where: { affiliateId } });
      if (count >= MAX_LINKS_PER_AFFILIATE) {
        return {
          error: `You can have up to ${MAX_LINKS_PER_AFFILIATE} links. Delete one to add another.`,
        };
      }

      await lockLinkCodes(tx, [code]);
      if (await isCodeRetiredByAnother(tx, code, affiliateId)) return { error: CODE_TAKEN };

      const created = await tx.affiliateLink.create({
        data: { affiliateId, code, destinationPath, isPrimary: false },
        select: { id: true },
      });
      // Taking back one's own retired code makes it live again.
      await tx.retiredLinkCode.deleteMany({ where: { code, affiliateId } });
      return { id: created.id };
    });
  } catch (err) {
    // A live code is still decided by the unique constraint, and this is
    // where that answer is read.
    if (isUniqueViolation(err)) return { error: CODE_TAKEN };
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

  try {
    return await db.$transaction(async (tx) => {
      // Scoped by affiliateId, so one Affiliate cannot rename another's link
      // into their own.
      const link = await tx.affiliateLink.findFirst({
        where: { id: linkId, affiliateId },
        select: { code: true, affiliate: { select: { merchantId: true } } },
      });
      if (!link) return { error: LINK_GONE };

      const renamed = link.code !== code;
      if (renamed) {
        if (await retiredCodesFull(tx, affiliateId, code)) return { error: TOO_MANY_RETIRED };
        await lockLinkCodes(tx, [link.code, code]);
        if (await isCodeRetiredByAnother(tx, code, affiliateId)) return { error: CODE_TAKEN };
      }

      // Matched on the code read above as well, so a concurrent rename of the
      // same link cannot leave a different code retired than the one replaced.
      const result = await tx.affiliateLink.updateMany({
        where: { id: linkId, affiliateId, code: link.code },
        data: { code, destinationPath },
      });
      if (result.count === 0) return { error: LINK_GONE };

      if (renamed) {
        // The old code stays with this Affiliate for good, since links carrying
        // it are already out in the world.
        await tx.retiredLinkCode.deleteMany({ where: { code, affiliateId } });
        await retireCode(tx, link.code, affiliateId, link.affiliate.merchantId);
      }
      return { ok: true as const };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { error: CODE_TAKEN };
    throw err;
  }
}

export async function deleteLink(
  affiliateId: string,
  linkId: string
): Promise<{ error: string } | { ok: true }> {
  return db.$transaction(async (tx) => {
    const link = await tx.affiliateLink.findFirst({
      where: { id: linkId, affiliateId },
      select: { code: true, isPrimary: true, affiliate: { select: { merchantId: true } } },
    });
    if (!link) return { error: LINK_GONE };
    if (link.isPrimary) return { error: "Your signup link cannot be deleted." };
    if (await retiredCodesFull(tx, affiliateId, null)) return { error: TOO_MANY_RETIRED };

    await lockLinkCodes(tx, [link.code]);
    // Click.linkId is ON DELETE SET NULL, so the clicks and every Commission
    // behind them survive. Only the per-link attribution is lost, which is the
    // honest outcome: the link is gone.
    const deleted = await tx.affiliateLink.deleteMany({ where: { id: linkId, affiliateId } });
    if (deleted.count === 0) return { error: LINK_GONE };
    await retireCode(tx, link.code, affiliateId, link.affiliate.merchantId);
    return { ok: true as const };
  });
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
