import type { Merchant } from "@prisma/client";
import { db } from "@/lib/db";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { recordTrackingVerified } from "@/lib/tracking";
import { REFERRAL_CLIENT_REFERENCE_PREFIX, REFERRAL_METADATA_KEY } from "@/lib/referral";
import { linkClickFor, referralThrough, REFERRAL_INCLUDE, type ReferralClick } from "@/lib/worker/attribution";
import { commissionRateFor, computeCommissionAmount, computePayableAt, saleAmountFor, type PaymentRef } from "@/lib/worker/commission";
import { commissionFieldsAtCreation } from "@/lib/worker/paymentState";
import { createCommissionUnlessSelfReferral } from "@/lib/worker/recordCommission";
import { referralStillEarns } from "@/lib/worker/referralDuration";
import {
  claimFirstPayment,
  recordReferredSubscription,
  referredSubscriptionFor,
} from "@/lib/worker/referredSubscription";
import { checkSelfReferralEmail } from "@/lib/worker/selfReferral";
import { hasPolarExclusionFlag, type PolarOrder } from "@/lib/payments/polar/types";

// A checkout's own order. A trial's start arrives here too, as a paid order of
// nothing, so it records the subscription and earns nothing until money moves.
const FIRST_ORDER = new Set(["purchase", "subscription_create"]);

// A renewal or a plan change of the subscription the referral bought, and the
// first charge after a trial. Usage billing (subscription_meter_cycle) is left
// out, as on Stripe, and so is the final order of a cancellation.
const RENEWAL = new Set(["subscription_cycle", "subscription_cycle_after_trial", "subscription_update"]);

export async function handleOrderPaid(merchant: Merchant, order: PolarOrder): Promise<void> {
  const payment: PaymentRef = { ref: order.id, at: new Date(order.created_at) };
  if (FIRST_ORDER.has(order.billing_reason)) return firstOrder(merchant, order, payment);
  if (RENEWAL.has(order.billing_reason)) return renewal(merchant, order, payment);
}

/**
 * The token a checkout carries. Supaffi's own key wins, set by the owner's
 * checkout code. A checkout link cannot carry custom metadata, so the tracking
 * script puts the token in its reference_id, which Polar copies into the
 * checkout's metadata (polar.sh/docs/features/checkout/links), behind a prefix
 * so an owner's own reference is never read as one.
 */
function referralTokenOf(order: PolarOrder): string | undefined {
  const own = order.metadata?.[REFERRAL_METADATA_KEY];
  if (typeof own === "string" && own) return own;
  const reference = order.metadata?.reference_id;
  if (typeof reference === "string" && reference.startsWith(REFERRAL_CLIENT_REFERENCE_PREFIX)) {
    return reference.slice(REFERRAL_CLIENT_REFERENCE_PREFIX.length);
  }
  return undefined;
}

async function firstOrder(merchant: Merchant, order: PolarOrder, payment: PaymentRef): Promise<void> {
  const linkClick = await linkClickFor(merchant.id, referralTokenOf(order), payment.at);
  // A click existed and its token came back on the order: the script is live
  // and the checkout passes the token through.
  if (linkClick) await recordTrackingVerified(merchant.id);

  // An affiliate's promo code wins over another affiliate's link, as on
  // Stripe. The order names the discount it used, which is the code's id.
  let click = await referralThrough(merchant.id, {
    checkoutRef: order.checkout_id ?? order.id,
    at: payment.at,
    linkClick,
    promoCode: async () =>
      order.discount_id
        ? db.affiliatePromoCode.findFirst({ where: { merchantId: merchant.id, promoCodeRef: order.discount_id, disabledAt: null } })
        : null,
  });
  if (!click || click.fraudConfirmedAt) return;

  const moneyMoved = order.net_amount > 0;
  if (order.subscription_id) {
    // Renewals earn by matching this subscription, never the customer, and
    // only on the product it was bought for. Recorded for a trial too, so its
    // first paid order can earn.
    const referred = await recordReferredSubscription(
      merchant.id,
      click.id,
      order.subscription_id,
      order.product_id ? [order.product_id] : []
    );
    if (referred.clickId !== click.id) {
      click = await db.click.findUniqueOrThrow({ where: { id: referred.clickId }, include: REFERRAL_INCLUDE });
      if (click.fraudConfirmedAt) return;
    }
    if (moneyMoved) await claimFirstPayment(referred, payment);
  }
  if (!moneyMoved) return;
  await earn(merchant, click, order, payment);
}

async function renewal(merchant: Merchant, order: PolarOrder, payment: PaymentRef): Promise<void> {
  if (!order.subscription_id || order.net_amount <= 0) return;
  const referred = await referredSubscriptionFor(merchant.id, order.subscription_id);
  if (!referred || referred.click.fraudConfirmedAt) return;

  // The first payment is when money first moved, whether or not it earns.
  await claimFirstPayment(referred, payment);

  // Every renewal of the referred subscription earns, whatever product it now
  // bills. A Polar product has a single billing interval, so moving from
  // monthly to yearly is a change of product; on Stripe it is a change of
  // price within one product, which earns there too.
  await earn(merchant, referred.click, order, payment);
}

async function earn(merchant: Merchant, click: ReferralClick, order: PolarOrder, payment: PaymentRef): Promise<void> {
  const affiliate = click.affiliate;
  const program = affiliate.program;
  if (!(await referralStillEarns(merchant.id, click.id, program, payment))) return;

  const rate = commissionRateFor(affiliate, program);
  if (rate <= 0) return;
  if (hasPolarExclusionFlag(order.metadata, order.subscription?.metadata, order.customer?.metadata)) return;

  // Earned on the order after its discount and before tax. Polar's own fee is
  // not taken off, as Stripe's is not.
  const baseMinor = order.net_amount;
  const amount = computeCommissionAmount(baseMinor, order.currency, rate);
  if (amount.lte(0)) return;

  const flagReason = checkSelfReferralEmail(affiliate, order.customer?.email ?? null);
  // A refund Polar had already made when it sent this event is on the order.
  // One made later waits for this row (orderRefunded.ts). Polar sends no
  // dispute events, so disputes are not read.
  const charge = { amount: order.net_amount, amountRefunded: order.refunded_amount ?? 0, disputed: false };

  try {
    await createCommissionUnlessSelfReferral({
      data: {
        affiliateId: affiliate.id,
        clickId: click.id,
        paymentRef: order.id,
        currency: order.currency,
        saleAmount: saleAmountFor(baseMinor, order.currency),
        payableAt: computePayableAt(program),
        flagReason,
        ...commissionFieldsAtCreation({ amount, flagReason, charge }),
      },
    });
  } catch (err) {
    // A redelivered order.paid finds the row already written.
    if (!isUniqueConstraintError(err)) throw err;
  }
}
