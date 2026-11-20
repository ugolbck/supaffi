import { Prisma, type PaymentProvider } from "@prisma/client";
import { db } from "@/lib/db";
import { isCodeRetiredByAnother, lockLinkCodes } from "@/lib/affiliateLink";
import { generateLinkCode } from "@/lib/referralCode";
import { composePayoutDetails } from "@/lib/payoutMethod";
import { stripeClientFor } from "@/lib/payments/stripe/client";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import {
  IMPORT_SOURCES,
  type CampaignMapping,
  type FetchedProgram,
  type ImportSourceKey,
  type ImportSummary,
  type SourceCommission,
} from "./types";

/**
 * Writes another tool's program into a product. Running it twice writes
 * nothing twice: affiliates are matched on email, links on code, referrals on
 * a click token and commissions on a payment reference, each named after the
 * other tool's own id.
 *
 * No email goes out: nobody is told they joined, earned or were paid. Old
 * commissions are history, and the Owner invites the affiliates when ready.
 */

type Merchant = { id: string; paymentProvider: PaymentProvider; paymentKeyEnc: string | null };
type ProgramTerms = { id: string; holdingPeriodDays: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/** The marker on everything an import wrote, unique per tool and per the tool's own id. */
export function importRef(source: ImportSourceKey, kind: "referral" | "affiliate" | "commission", id: string): string {
  return `import:${source.toLowerCase()}:${kind === "commission" ? "" : `${kind}:`}${id}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function dateOr(value: string | null | undefined, fallback: Date): Date {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : fallback;
}

/**
 * The codes an affiliate's links use, written where free. A code another
 * product's affiliate holds, or once held, is not taken from them: it is
 * listed, and the affiliate gets a new code if left with none.
 */
async function writeLinks(affiliateId: string, name: string | null, codes: string[], taken: string[]): Promise<void> {
  const wanted = [...new Set(codes.map((c) => c.trim()).filter((c) => c.length >= 1 && c.length <= 100))];
  await db.$transaction(async (tx) => {
    await lockLinkCodes(tx, wanted);
    let hasPrimary = (await tx.affiliateLink.count({ where: { affiliateId, isPrimary: true } })) > 0;
    for (const code of wanted) {
      const existing = await tx.affiliateLink.findUnique({ where: { code }, select: { affiliateId: true } });
      if (existing) {
        if (existing.affiliateId !== affiliateId) taken.push(code);
        continue;
      }
      if (await isCodeRetiredByAnother(tx, code, affiliateId)) {
        taken.push(code);
        continue;
      }
      await tx.affiliateLink.create({ data: { affiliateId, code, isPrimary: !hasPrimary } });
      hasPrimary = true;
    }
  });
  if ((await db.affiliateLink.count({ where: { affiliateId } })) === 0) {
    const code = await generateLinkCode(name ?? "");
    await db.$transaction(async (tx) => {
      await lockLinkCodes(tx, [code]);
      await tx.affiliateLink.create({ data: { affiliateId, code, isPrimary: true } });
    });
  }
}

/**
 * The subscriptions a Stripe customer has, for a tool that knows only the
 * customer. That tool credited every payment the customer made, so they all
 * keep earning here. A key that cannot list them links none.
 */
async function customerSubscriptions(merchant: Merchant, customerId: string): Promise<string[]> {
  if (merchant.paymentProvider !== "STRIPE" || !merchant.paymentKeyEnc) return [];
  try {
    const stripe = stripeClientFor(merchant);
    const list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
    return list.data.filter((s) => !["canceled", "incomplete_expired"].includes(s.status)).map((s) => s.id);
  } catch {
    return [];
  }
}

export async function applyImport(
  merchant: Merchant,
  source: ImportSourceKey,
  fetched: FetchedProgram,
  mapping: CampaignMapping
): Promise<ImportSummary> {
  const now = new Date();
  const summary: ImportSummary = {
    affiliatesCreated: 0,
    affiliatesMatched: 0,
    codesTaken: [],
    referrals: 0,
    subscriptionsLinked: 0,
    commissionsOwed: 0,
    commissionsPaid: 0,
    commissionsSkipped: 0,
  };

  const programs = await db.program.findMany({
    where: { merchantId: merchant.id },
    select: { id: true, holdingPeriodDays: true },
    orderBy: { createdAt: "asc" },
  });
  if (programs.length === 0) throw new Error("The product has no program to import into");
  const programById = new Map(programs.map((p) => [p.id, p]));
  const programFor = (campaignId: string | null): ProgramTerms =>
    programById.get(mapping[campaignId ?? ""] ?? "") ?? programs[0];

  // Affiliates, one per email, with their payout details and links.
  const affiliates = new Map<string, { id: string; programId: string }>();
  for (const source of fetched.affiliates) {
    const email = normalizeEmail(source.email);
    if (!email.includes("@")) continue;
    const program = programFor(source.campaignId);
    let affiliate = await db.affiliate.findUnique({
      where: { merchantId_email: { merchantId: merchant.id, email } },
      select: { id: true, programId: true },
    });
    if (affiliate) {
      summary.affiliatesMatched += 1;
    } else {
      const payoutDetails = source.paypalEmail
        ? composePayoutDetails("paypal", source.paypalEmail)
        : source.wiseEmail
          ? composePayoutDetails("wise", source.wiseEmail)
          : null;
      try {
        affiliate = await db.affiliate.create({
          data: { merchantId: merchant.id, programId: program.id, email, name: source.name, payoutDetails },
          select: { id: true, programId: true },
        });
        summary.affiliatesCreated += 1;
      } catch (err) {
        // Signed up in between: the same person, so theirs is matched.
        if (!isUniqueConstraintError(err)) throw err;
        affiliate = await db.affiliate.findUniqueOrThrow({
          where: { merchantId_email: { merchantId: merchant.id, email } },
          select: { id: true, programId: true },
        });
        summary.affiliatesMatched += 1;
      }
    }
    await writeLinks(affiliate.id, source.name, source.codes, summary.codesTaken);
    affiliates.set(source.id, affiliate);
  }

  // Each referred customer stands as a click that expired the day it was
  // made, carrying the program the affiliate is in.
  const clickFor = async (token: string, affiliate: { id: string; programId: string }, at: Date) => {
    const existing = await db.click.findUnique({ where: { referralToken: token }, select: { id: true } });
    if (existing) return existing.id;
    try {
      const click = await db.click.create({
        data: { affiliateId: affiliate.id, programId: affiliate.programId, referralToken: token, expiresAt: at, createdAt: at },
        select: { id: true },
      });
      return click.id;
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      return (await db.click.findUniqueOrThrow({ where: { referralToken: token }, select: { id: true } })).id;
    }
  };

  const referralClicks = new Map<string, string>();
  for (const referral of fetched.referrals) {
    const affiliate = affiliates.get(referral.affiliateId);
    if (!affiliate) continue;
    const at = dateOr(referral.createdAt, now);
    const clickId = await clickFor(importRef(source, "referral", referral.id), affiliate, at);
    referralClicks.set(referral.id, clickId);
    summary.referrals += 1;

    const subscriptions = referral.subscriptionId
      ? [referral.subscriptionId]
      : referral.stripeCustomerId
        ? await customerSubscriptions(merchant, referral.stripeCustomerId)
        : [];
    for (const subscriptionRef of subscriptions) {
      try {
        await db.referredSubscription.create({ data: { merchantId: merchant.id, clickId, subscriptionRef } });
        summary.subscriptionsLinked += 1;
      } catch (err) {
        // Already linked, by an earlier run or by a checkout here.
        if (!isUniqueConstraintError(err)) throw err;
      }
    }
  }

  // Commissions, as history. A voided one is left behind.
  const already = new Set(
    (
      await db.commission.findMany({
        where: { merchantId: merchant.id, paymentRef: { startsWith: `import:${source.toLowerCase()}:` } },
        select: { paymentRef: true },
      })
    ).map((c) => c.paymentRef)
  );
  const fallbackClicks = new Map<string, string>();
  const rows: (Prisma.CommissionCreateManyInput & { source: SourceCommission })[] = [];
  for (const commission of fetched.commissions) {
    if (commission.state === "void") continue;
    const affiliate = affiliates.get(commission.affiliateId);
    if (!affiliate || !(Number(commission.amount) > 0)) continue;
    const paymentRef = importRef(source, "commission", commission.id);
    if (already.has(paymentRef)) {
      summary.commissionsSkipped += 1;
      continue;
    }
    already.add(paymentRef);

    let clickId = commission.referralId ? referralClicks.get(commission.referralId) : undefined;
    if (!clickId) {
      clickId = fallbackClicks.get(affiliate.id);
      if (!clickId) {
        clickId = await clickFor(importRef(source, "affiliate", commission.affiliateId), affiliate, now);
        fallbackClicks.set(affiliate.id, clickId);
      }
    }
    const createdAt = dateOr(commission.createdAt, now);
    const hold = programById.get(affiliate.programId)?.holdingPeriodDays ?? 30;
    const status = commission.state === "paid" ? "PAID" : commission.state === "owed" ? "PAYABLE" : "PENDING";
    rows.push({
      source: commission,
      merchantId: merchant.id,
      affiliateId: affiliate.id,
      clickId,
      paymentRef,
      amount: commission.amount,
      grossAmount: commission.amount,
      currency: commission.currency,
      status,
      createdAt,
      payableAt: status === "PENDING" ? new Date(createdAt.getTime() + hold * DAY_MS) : createdAt,
      paidAt: status === "PAID" ? dateOr(commission.paidAt, createdAt) : null,
    });
  }

  // Paid ones are grouped into the payouts they were, one per affiliate,
  // currency and payment moment, as Mark paid writes them.
  const payouts = new Map<string, { rows: typeof rows; total: Prisma.Decimal }>();
  for (const row of rows) {
    if (row.status !== "PAID") continue;
    const key = `${row.affiliateId}:${row.currency}:${(row.paidAt as Date).getTime()}`;
    const group = payouts.get(key) ?? { rows: [], total: new Prisma.Decimal(0) };
    group.rows.push(row);
    group.total = group.total.add(row.amount as string);
    payouts.set(key, group);
  }
  const label = IMPORT_SOURCES[source].label;
  for (const group of payouts.values()) {
    const [first] = group.rows;
    const payout = await db.payout.create({
      data: {
        merchantId: merchant.id,
        affiliateId: first.affiliateId,
        currency: first.currency,
        amount: group.total,
        paidAt: first.paidAt as Date,
        note: `Paid in ${label}`,
        createdAt: first.paidAt as Date,
      },
      select: { id: true },
    });
    for (const row of group.rows) row.payoutId = payout.id;
  }

  for (let i = 0; i < rows.length; i += 1000) {
    const { count } = await db.commission.createMany({
      data: rows.slice(i, i + 1000).map(({ source: _source, ...row }) => row),
      skipDuplicates: true,
    });
    summary.commissionsSkipped += Math.min(1000, rows.length - i) - count;
  }
  summary.commissionsPaid = rows.filter((r) => r.status === "PAID").length;
  summary.commissionsOwed = rows.length - summary.commissionsPaid;

  const param = fetched.referralParam !== undefined ? fetched.referralParam : IMPORT_SOURCES[source].referralParam;
  // Written into the tracking script, so only a plain parameter name.
  if (param && /^[A-Za-z0-9_-]{1,30}$/.test(param)) {
    await db.merchant.update({ where: { id: merchant.id }, data: { legacyReferralParam: param } });
  }
  return summary;
}
