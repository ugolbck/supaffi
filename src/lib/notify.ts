import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isSingleAddress, productMail, type OutgoingEmail } from "@/lib/mail";
import {
  earnedEmail,
  flaggedSaleEmail,
  newAffiliateEmail,
  newSaleEmail,
  paidEmail,
  passwordLinkEmail,
  welcomeEmail,
} from "@/lib/emails";
import { formatDate, formatMoney, termsLine } from "@/lib/format";
import { linkUrl } from "@/lib/affiliateLink";
import { dashboardOrigin } from "@/lib/instance";
import { originFor } from "@/lib/url";
import { issueResetToken } from "@/lib/affiliatePassword";

/**
 * Queues the emails an event calls for, inside the transaction that records
 * the event. Nothing is queued while the product has email off, so an instance
 * without it behaves exactly as before.
 *
 * Each email has a key unique per product, so an event processed twice (a
 * redelivered webhook, a retried action) queues it once.
 */

type Tx = Prisma.TransactionClient;

async function queue(tx: Tx, merchantId: string, emails: { key: string; email: OutgoingEmail }[]): Promise<void> {
  // One plain address per email. Signup accepts loose addresses, and a comma
  // list would otherwise have the Owner's server copy the email to strangers.
  const sendable = emails.filter(({ email }) => isSingleAddress(email.to));
  if (sendable.length === 0) return;
  await tx.email.createMany({
    data: sendable.map(({ key, email }) => ({ merchantId, dedupeKey: key, ...email })),
    skipDuplicates: true,
  });
}

function ownerLink(path: string): string | null {
  const origin = dashboardOrigin();
  return origin ? `${origin}${path}` : null;
}

/** A new Affiliate: the Owner hears who, and the Affiliate gets their link. */
export async function notifyAffiliateJoined(tx: Tx, affiliateId: string): Promise<void> {
  const affiliate = await tx.affiliate.findUnique({
    where: { id: affiliateId },
    select: {
      id: true,
      email: true,
      name: true,
      customCommissionRate: true,
      links: { where: { isPrimary: true }, select: { code: true, destinationPath: true }, take: 1 },
      program: {
        select: {
          name: true,
          defaultCommissionRate: true,
          commissionDurationType: true,
          commissionDurationMonths: true,
          attributionWindowDays: true,
          holdingPeriodDays: true,
          stripeCouponId: true,
          discountLabel: true,
        },
      },
      merchant: { select: { id: true, name: true, slug: true, domain: true, websiteUrl: true } },
    },
  });
  if (!affiliate) return;
  const { merchant, program } = affiliate;
  const mail = await productMail(merchant.id, tx);
  if (!mail) return;

  const emails: { key: string; email: OutgoingEmail }[] = [];
  if (mail.notifyNewAffiliates) {
    emails.push({
      key: `joined:${affiliate.id}`,
      email: newAffiliateEmail({
        to: mail.ownerEmail,
        product: merchant.name,
        affiliate,
        program: program.name,
        href: ownerLink(`/dashboard/products/${merchant.slug}/affiliates?affiliate=${affiliate.id}`),
      }),
    });
  }
  const link = affiliate.links[0];
  if (mail.emailAffiliates && link) {
    const terms = termsLine({
      rate: Number(affiliate.customCommissionRate ?? program.defaultCommissionRate),
      durationType: program.commissionDurationType,
      durationMonths: program.commissionDurationMonths,
      attributionWindowDays: program.attributionWindowDays,
      holdingPeriodDays: program.holdingPeriodDays,
    }).split(" · ")[0];
    emails.push({
      key: `welcome:${affiliate.id}`,
      email: welcomeEmail({
        to: affiliate.email,
        product: merchant.name,
        link: linkUrl(merchant.websiteUrl, link),
        terms,
        discount: program.stripeCouponId ? program.discountLabel : null,
        href: `${originFor(merchant.domain)}/affiliates/dashboard`,
      }),
    });
  }
  await queue(tx, merchant.id, emails);
}

/**
 * A commission just written. Only a referred customer's first one is
 * announced: renewals arrive every month for every subscriber and would bury
 * the one email that matters. A flagged sale goes to the Owner alone, since
 * the Affiliate may not earn it, and whatever the sales switch says, since it
 * needs their decision. A sale refunded before it was recorded is
 * not news.
 */
export async function notifyCommission(tx: Tx, commissionId: string): Promise<void> {
  const commission = await tx.commission.findUnique({
    where: { id: commissionId },
    select: {
      id: true,
      clickId: true,
      amount: true,
      currency: true,
      saleAmount: true,
      status: true,
      payableAt: true,
      createdAt: true,
      affiliate: {
        select: {
          email: true,
          name: true,
          merchant: { select: { id: true, name: true, slug: true, domain: true } },
        },
      },
    },
  });
  if (!commission || commission.status === "VOIDED") return;
  const earlier = await tx.commission.count({
    where: { clickId: commission.clickId, id: { not: commission.id }, createdAt: { lte: commission.createdAt } },
  });
  if (earlier > 0) return;

  const { affiliate } = commission;
  const { merchant } = affiliate;
  const mail = await productMail(merchant.id, tx);
  if (!mail) return;

  const amount = formatMoney(commission.amount.toString(), commission.currency);
  const payableOn = formatDate(commission.payableAt);
  const href = ownerLink(`/dashboard/products/${merchant.slug}/commissions?commission=${commission.id}`);
  const emails: { key: string; email: OutgoingEmail }[] = [];

  if (commission.status === "FLAGGED") {
    // Not behind the sales switch: it asks the Owner for a decision.
    emails.push({
      key: `flagged:${commission.id}`,
      email: flaggedSaleEmail({
        to: mail.ownerEmail,
        product: merchant.name,
        affiliate,
        commission: amount,
        href: ownerLink(`/dashboard/products/${merchant.slug}/commissions?status=FLAGGED&commission=${commission.id}`),
      }),
    });
  } else {
    if (mail.notifyNewSales) {
      emails.push({
        key: `sale:${commission.id}`,
        email: newSaleEmail({
          to: mail.ownerEmail,
          product: merchant.name,
          affiliate,
          sale: commission.saleAmount ? formatMoney(commission.saleAmount.toString(), commission.currency) : null,
          commission: amount,
          payableOn,
          href,
        }),
      });
    }
    if (mail.emailAffiliates) {
      emails.push({
        key: `earned:${commission.id}`,
        email: earnedEmail({
          to: affiliate.email,
          product: merchant.name,
          commission: amount,
          payableOn,
          href: `${originFor(merchant.domain)}/affiliates/dashboard/commissions`,
        }),
      });
    }
  }
  await queue(tx, merchant.id, emails);
}

/** A payout marked paid: one email for the whole of it. */
export async function notifyPaid(
  tx: Tx,
  args: { affiliateId: string; paidAt: Date; total: string; currency: string }
): Promise<void> {
  const affiliate = await tx.affiliate.findUnique({
    where: { id: args.affiliateId },
    select: { email: true, merchant: { select: { id: true, name: true, domain: true } } },
  });
  if (!affiliate) return;
  const mail = await productMail(affiliate.merchant.id, tx);
  if (!mail?.emailAffiliates) return;
  await queue(tx, affiliate.merchant.id, [
    {
      key: `paid:${args.affiliateId}:${args.paidAt.getTime()}`,
      email: paidEmail({
        to: affiliate.email,
        product: affiliate.merchant.name,
        amount: formatMoney(args.total, args.currency),
        href: `${originFor(affiliate.merchant.domain)}/affiliates/dashboard/payouts`,
      }),
    },
  ]);
}

export const SELF_SERVE_LINK_TTL_MS = 60 * 60_000;

/**
 * Emails a password link to an Affiliate who asked for one. Sent whatever the
 * switches say: it is asked for, not announced. It lasts an hour and replaces
 * no other link (see issueResetToken), so a stranger who knows the email
 * cannot void one the Owner copied for them. Answers false while the product
 * has email off.
 */
export async function emailPasswordLink(affiliateId: string): Promise<boolean> {
  const affiliate = await db.affiliate.findUnique({
    where: { id: affiliateId },
    select: { id: true, email: true, merchant: { select: { id: true, name: true, domain: true } } },
  });
  if (!affiliate) return false;
  if (!(await productMail(affiliate.merchant.id))) return false;

  await db.$transaction(async (tx) => {
    const token = await issueResetToken(tx, affiliateId, SELF_SERVE_LINK_TTL_MS, { replace: false });
    await queue(tx, affiliate.merchant.id, [
      {
        key: `password:${token.id}`,
        email: passwordLinkEmail({
          to: affiliate.email,
          product: affiliate.merchant.name,
          href: `${originFor(affiliate.merchant.domain)}/affiliates/password?token=${token.rawToken}`,
        }),
      },
    ]);
  });
  return true;
}
