import type { Prisma } from "@prisma/client";
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
