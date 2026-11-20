import { Prisma, type PaymentProvider } from "@prisma/client";
import { db } from "@/lib/db";
import { isCodeRetiredByAnother, lockLinkCodes } from "@/lib/affiliateLink";
import { validateCode } from "@/lib/linkCode";
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far a subscription's start may be from the referral for the subscription to be the one it brought. */
const SUBSCRIPTION_WINDOW_MS = 3 * DAY_MS;

/** A commission's payment reference, unique per product. */
export function importRef(source: ImportSourceKey, id: string): string {
  return `import:${source.toLowerCase()}:${id}`;
}

/** A click's token, unique on the whole instance, so the product is in it. */
function clickToken(source: ImportSourceKey, merchantId: string, kind: "referral" | "affiliate", id: string): string {
  return `import:${source.toLowerCase()}:${merchantId}:${kind}:${id}`;
}

/**
 * A code as this product keeps it: lowercase, and a valid code here. Old links
 * still arrive in whatever case they were shared, which the tracking endpoint
 * lowercases. Null for a code no link here could carry.
 */
export function importCode(raw: string): string | null {
  const result = validateCode(raw);
  return result.error === null ? result.code : null;
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
async function writeLinks(affiliateId: string, name: string | null, raw: string[], summary: ImportSummary): Promise<void> {
  const wanted: string[] = [];
  for (const code of raw) {
    const clean = importCode(code);
    if (clean) wanted.push(clean);
    else if (code.trim()) summary.codesInvalid.push(code.trim());
  }
  const codes = [...new Set(wanted)];
  await db.$transaction(async (tx) => {
    await lockLinkCodes(tx, codes);
    let hasPrimary = (await tx.affiliateLink.count({ where: { affiliateId, isPrimary: true } })) > 0;
    for (const code of codes) {
      const existing = await tx.affiliateLink.findUnique({ where: { code }, select: { affiliateId: true } });
      if (existing) {
        if (existing.affiliateId !== affiliateId) summary.codesTaken.push(code);
        continue;
      }
      if (await isCodeRetiredByAnother(tx, code, affiliateId)) {
        summary.codesTaken.push(code);
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
 * The subscriptions a referral brought, for a tool that knows only the Stripe
 * customer: those the customer started within a few days of the referral, with
 * the products they bill, so renewals earn on those products only, as a
 * referred checkout's would. A customer's later subscriptions, or ones for
 * another product on a shared Stripe account, were not referred. A key that
 * cannot list them links none.
 */
async function referredSubscriptions(
  merchant: Merchant,
  customerId: string,
  referredAt: Date
): Promise<{ id: string; products: string[] }[]> {
  if (merchant.paymentProvider !== "STRIPE" || !merchant.paymentKeyEnc) return [];
  try {
    const stripe = stripeClientFor(merchant);
    const list = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
    return list.data
      .filter((s) => !["canceled", "incomplete_expired"].includes(s.status))
      .filter((s) => Math.abs(s.created * 1000 - referredAt.getTime()) <= SUBSCRIPTION_WINDOW_MS)
      .map((s) => ({
        id: s.id,
        products: [
          ...new Set(
            s.items.data
              .map((item) => (typeof item.price.product === "string" ? item.price.product : item.price.product?.id))
              .filter((id): id is string => Boolean(id))
          ),
        ].sort(),
      }));
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
    createdAffiliateIds: [],
    affiliatesCreated: 0,
    affiliatesMatched: 0,
    codesTaken: [],
    codesInvalid: [],
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
  const programFor = (campaignId: string | null) => programById.get(mapping[campaignId ?? ""] ?? "") ?? programs[0];

  // Affiliates, one per email, with their payout details and links.
  const affiliates = new Map<string, { id: string; programId: string }>();
  for (const source of fetched.affiliates) {
    const email = normalizeEmail(source.email);
    if (!email.includes("@")) continue;
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
          data: { merchantId: merchant.id, programId: programFor(source.campaignId).id, email, name: source.name, payoutDetails },
          select: { id: true, programId: true },
        });
        summary.affiliatesCreated += 1;
        summary.createdAffiliateIds.push(affiliate.id);
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
    await writeLinks(affiliate.id, source.name, source.codes, summary);
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
    referralClicks.set(referral.id, await clickFor(clickToken(source, merchant.id, "referral", referral.id), affiliate, at));
    summary.referrals += 1;
  }

  // Commissions, as history, before any subscription is linked: a renewal
  // that arrives meanwhile then finds the referral's earlier commissions and
  // is judged against the program's duration. A voided one is left behind.
  const already = new Set(
    (
      await db.commission.findMany({
        where: { merchantId: merchant.id, paymentRef: { startsWith: `import:${source.toLowerCase()}:` } },
        select: { paymentRef: true },
      })
    ).map((c) => c.paymentRef)
  );
  const fallbackClicks = new Map<string, string>();
  const unpaid: Prisma.CommissionCreateManyInput[] = [];
  // Paid ones grouped into the payouts they were: one per affiliate,
  // currency and day, since the tools record a payment's time loosely.
  const payouts = new Map<string, Prisma.CommissionCreateManyInput[]>();
  for (const commission of fetched.commissions) {
    if (commission.state === "void") continue;
    const affiliate = affiliates.get(commission.affiliateId);
    if (!affiliate || !(Number(commission.amount) > 0)) continue;
    const paymentRef = importRef(source, commission.id);
    if (already.has(paymentRef)) {
      summary.commissionsSkipped += 1;
      continue;
    }
    already.add(paymentRef);

    let clickId = commission.referralId ? referralClicks.get(commission.referralId) : undefined;
    if (!clickId) {
      clickId = fallbackClicks.get(affiliate.id);
      if (!clickId) {
        clickId = await clickFor(clickToken(source, merchant.id, "affiliate", commission.affiliateId), affiliate, now);
        fallbackClicks.set(affiliate.id, clickId);
      }
    }
    const createdAt = dateOr(commission.createdAt, now);
    const hold = programById.get(affiliate.programId)?.holdingPeriodDays ?? 30;
    const row: Prisma.CommissionCreateManyInput = {
      merchantId: merchant.id,
      affiliateId: affiliate.id,
      clickId,
      paymentRef,
      amount: commission.amount,
      grossAmount: commission.amount,
      currency: commission.currency,
      createdAt,
      status: "PENDING",
      payableAt: new Date(createdAt.getTime() + hold * DAY_MS),
    };
    if (commission.state === "paid") {
      const paidAt = dateOr(commission.paidAt, createdAt);
      const key = `${affiliate.id}:${commission.currency}:${paidAt.toISOString().slice(0, 10)}`;
      payouts.set(key, [...(payouts.get(key) ?? []), { ...row, status: "PAID", payableAt: createdAt, paidAt }]);
    } else {
      unpaid.push(commission.state === "owed" ? { ...row, status: "PAYABLE", payableAt: createdAt } : row);
    }
  }

  for (let i = 0; i < unpaid.length; i += 1000) {
    const batch = unpaid.slice(i, i + 1000);
    const { count } = await db.commission.createMany({ data: batch, skipDuplicates: true });
    summary.commissionsOwed += count;
    summary.commissionsSkipped += batch.length - count;
  }

  // Each payout with its commissions in one step, at what was actually
  // written, so a run that stops partway leaves no payout without its rows.
  const note = `Paid in ${IMPORT_SOURCES[source].label}`;
  for (const rows of payouts.values()) {
    const paidAt = new Date(Math.max(...rows.map((r) => (r.paidAt as Date).getTime())));
    await db.$transaction(async (tx) => {
      const payout = await tx.payout.create({
        data: { merchantId: merchant.id, affiliateId: rows[0].affiliateId, currency: rows[0].currency, amount: 0, paidAt, note, createdAt: paidAt },
        select: { id: true },
      });
      const { count } = await tx.commission.createMany({
        data: rows.map((r) => ({ ...r, paidAt, payoutId: payout.id })),
        skipDuplicates: true,
      });
      summary.commissionsPaid += count;
      summary.commissionsSkipped += rows.length - count;
      if (count === 0) {
        await tx.payout.delete({ where: { id: payout.id } });
        return;
      }
      const total = await tx.commission.aggregate({ where: { payoutId: payout.id }, _sum: { amount: true } });
      await tx.payout.update({ where: { id: payout.id }, data: { amount: total._sum.amount ?? 0 } });
    });
  }

  // Last, so renewals earn only once the history above is in place.
  for (const referral of fetched.referrals) {
    const clickId = referralClicks.get(referral.id);
    if (!clickId) continue;
    const subscriptions = referral.subscriptionId
      ? [{ id: referral.subscriptionId, products: [] as string[] }]
      : referral.stripeCustomerId
        ? await referredSubscriptions(merchant, referral.stripeCustomerId, dateOr(referral.createdAt, now))
        : [];
    for (const subscription of subscriptions) {
      try {
        await db.referredSubscription.create({
          data: { merchantId: merchant.id, clickId, subscriptionRef: subscription.id, productRefs: subscription.products },
        });
        summary.subscriptionsLinked += 1;
      } catch (err) {
        // Already linked, by an earlier run or by a checkout here.
        if (!isUniqueConstraintError(err)) throw err;
      }
    }
  }

  const param = fetched.referralParam !== undefined ? fetched.referralParam : IMPORT_SOURCES[source].referralParam;
  // Written into the tracking script, so only a plain parameter name.
  if (param && /^[A-Za-z0-9_-]{1,30}$/.test(param)) {
    await db.merchant.update({ where: { id: merchant.id }, data: { legacyReferralParam: param } });
  }
  return summary;
}
