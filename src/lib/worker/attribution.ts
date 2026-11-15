import { randomUUID } from "node:crypto";
import type { AffiliatePromoCode, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const REFERRAL_INCLUDE = { affiliate: { include: { program: true } } } as const;
export type ReferralClick = Prisma.ClickGetPayload<{ include: typeof REFERRAL_INCLUDE }>;

/**
 * The visitor's click a checkout carries the token of, if it is still inside
 * its Attribution Window.
 *
 * Scoped to the Merchant whose webhook this is. A token is just a string in
 * checkout metadata, so one minted for another Merchant's affiliate must not
 * earn a commission on this Merchant's sale. A promo code sale's click is
 * never one a token can name.
 */
export async function linkClickFor(
  merchantId: string,
  referralToken: string | null | undefined,
  completedAt: Date
): Promise<ReferralClick | null> {
  if (!referralToken) return null;
  const click = await db.click.findUnique({
    where: { referralToken, affiliate: { merchantId }, promoCheckoutRef: null },
    include: REFERRAL_INCLUDE,
  });
  if (!click) return null;

  // A stale/reused token past its Attribution Window doesn't count, even on
  // the very first purchase.
  if (click.expiresAt < completedAt) return null;
  return click;
}

/**
 * The click this sale earns through: the one a promo code stands in for when
 * the checkout used an Affiliate's code, otherwise the visitor's.
 *
 * The code wins over another Affiliate's link. The customer typed it at the
 * moment of paying, which is the latest and most deliberate thing they did; a
 * link may be weeks old. When both belong to the same Affiliate the visitor's
 * click is kept, so the sale still counts for the link it came through.
 *
 * Once a checkout has a code click it keeps it, whatever happens to the code
 * since: a redelivered event, or a second event for the same checkout, earns
 * through the same referral the first one recorded.
 */
export async function referralThrough(
  merchantId: string,
  input: {
    /** The checkout the sale came through, one promo code click per checkout. */
    checkoutRef: string;
    at: Date;
    linkClick: ReferralClick | null;
    /** The Affiliate's code the checkout used, if any. */
    promoCode: () => Promise<AffiliatePromoCode | null>;
  }
): Promise<ReferralClick | null> {
  const { checkoutRef, linkClick } = input;
  const recordedOn = (tx: Prisma.TransactionClient) =>
    tx.click.findFirst({
      where: { promoCheckoutRef: checkoutRef, affiliate: { merchantId } },
      include: REFERRAL_INCLUDE,
    });
  const recorded = await recordedOn(db);
  if (recorded) return recorded;

  // Read outside the transaction below: it can call the provider.
  const promoCode = await input.promoCode();
  if (!promoCode || promoCode.affiliateId === linkClick?.affiliateId) return linkClick;

  // Two deliveries for one checkout (Stripe's completed and
  // async_payment_succeeded, or a redelivery) can run at once, and the code
  // can change hands between them. Serialized on the checkout, the second
  // finds the first one's click instead of writing one for a different
  // affiliate.
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`promo-session:${merchantId}:${checkoutRef}`}, 0))`;
    const first = await recordedOn(tx);
    if (first) return first;
    return tx.click.create({
      data: {
        affiliateId: promoCode.affiliateId,
        promoCodeId: promoCode.id,
        promoCheckoutRef: checkoutRef,
        // Required and unique, and never handed to anyone: no browser holds
        // it, so no checkout can ever carry it back.
        referralToken: randomUUID(),
        // No Attribution Window: the sale is the referral. Nothing reads this
        // back for a code click.
        expiresAt: input.at,
      },
      include: REFERRAL_INCLUDE,
    });
  });
}
