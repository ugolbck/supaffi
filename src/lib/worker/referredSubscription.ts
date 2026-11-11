import type { Prisma, ReferredSubscription } from "@prisma/client";
import { db } from "@/lib/db";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import type { PaymentRef } from "./commission";

export const WITH_CLICK = {
  click: { include: { affiliate: { include: { program: true } } } },
} satisfies Prisma.ReferredSubscriptionInclude;

export type ReferredSubscriptionWithClick = Prisma.ReferredSubscriptionGetPayload<{
  include: typeof WITH_CLICK;
}>;

/**
 * Records that a referred Checkout Session created this subscription, with the
 * Stripe products it bills. A redelivered or retried checkout lands on the row
 * already there, and fills its products if the first attempt could not read
 * them.
 */
export async function recordReferredSubscription(
  merchantId: string,
  clickId: string,
  subscriptionRef: string,
  productRefs: string[] = []
): Promise<ReferredSubscription> {
  const where = { merchantId_subscriptionRef: { merchantId, subscriptionRef } };
  try {
    // A customer who cancelled and subscribed again through the same
    // referral is paying again, so the referral is no longer counted as gone.
    // Together, so a retry that finds the row already there never leaves the
    // old mark behind.
    const [created] = await db.$transaction([
      db.referredSubscription.create({ data: { merchantId, clickId, subscriptionRef, productRefs } }),
      db.click.updateMany({ where: { id: clickId, subscriptionCancelledAt: { not: null } }, data: { subscriptionCancelledAt: null } }),
    ]);
    return created;
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    const existing = await db.referredSubscription.findUniqueOrThrow({ where });
    if (existing.productRefs.length > 0 || productRefs.length === 0) return existing;
    await fillProductRefs(existing.id, productRefs);
    return db.referredSubscription.findUniqueOrThrow({ where });
  }
}

/**
 * Stores the products of a subscription recorded without them, unless another
 * event stored them first, and returns what is stored now. The first writer
 * wins so every later invoice is measured against one set.
 */
export async function fillProductRefs(referredId: string, productRefs: string[]): Promise<string[]> {
  if (productRefs.length > 0) {
    await db.referredSubscription.updateMany({
      where: { id: referredId, productRefs: { isEmpty: true } },
      data: { productRefs },
    });
  }
  const current = await db.referredSubscription.findUniqueOrThrow({
    where: { id: referredId },
    select: { productRefs: true },
  });
  return current.productRefs;
}

/**
 * The referral behind a subscription on this Merchant, or null when nobody
 * referred it.
 *
 * Scoped to the Merchant whose webhook this is. Products sharing one payment
 * account each receive a copy of every event, and only the product whose
 * referred checkout created the subscription has a row for it.
 */
export function referredSubscriptionFor(
  merchantId: string,
  subscriptionRef: string
): Promise<ReferredSubscriptionWithClick | null> {
  return db.referredSubscription.findUnique({
    where: { merchantId_subscriptionRef: { merchantId, subscriptionRef } },
    include: WITH_CLICK,
  });
}

/**
 * Records `payment` as the subscription's first payment unless one is already
 * recorded, and returns whichever is first.
 *
 * The write only lands while the column is still empty, so two events racing
 * cannot both claim it, and a retried event whose commission failed to save
 * still recognises its own payment as the first.
 *
 * Stripe does not guarantee delivery order, so an invoice dated after the
 * true first payment can be processed first and claim the ref. When a later
 * event then brings an earlier-dated payment, the date moves back to it so
 * a FIXED_MONTHS window is still measured from when the subscription truly
 * started, but the ref stays put: it is what a ONE_TIME program already paid
 * on, and that payment must stay the only one it ever pays.
 */
export async function claimFirstPayment(
  referred: { id: string; firstPaymentRef: string | null; firstPaidAt: Date | null },
  payment: PaymentRef
): Promise<PaymentRef> {
  if (referred.firstPaymentRef && referred.firstPaidAt) {
    if (payment.at.getTime() >= referred.firstPaidAt.getTime()) {
      return { ref: referred.firstPaymentRef, at: referred.firstPaidAt };
    }
    await db.referredSubscription.updateMany({
      where: { id: referred.id, firstPaidAt: { gt: payment.at } },
      data: { firstPaidAt: payment.at },
    });
    const current = await db.referredSubscription.findUniqueOrThrow({
      where: { id: referred.id },
      select: { firstPaidAt: true },
    });
    return { ref: referred.firstPaymentRef, at: current.firstPaidAt ?? payment.at };
  }
  await db.referredSubscription.updateMany({
    where: { id: referred.id, firstPaymentRef: null },
    data: { firstPaymentRef: payment.ref, firstPaidAt: payment.at },
  });
  const current = await db.referredSubscription.findUniqueOrThrow({
    where: { id: referred.id },
    select: { firstPaymentRef: true, firstPaidAt: true },
  });
  return { ref: current.firstPaymentRef ?? payment.ref, at: current.firstPaidAt ?? payment.at };
}
