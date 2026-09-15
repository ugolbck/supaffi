import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeClientFor } from "@/lib/stripe";
import { commissionRateFor, computeCommissionAmount, computePayableAt, isExcluded, saleAmountFor } from "../commission";
import {
  commissionFieldsAtCreation,
  disputeStateAtCreation,
  latestChargeFor,
  paymentIntentForInvoice,
} from "../paymentState";
import { checkoutSessionBaseMinor } from "../saleBase";
import { exclusionSourcesOf, retrieveInvoiceForEarning } from "../referredRevenue";
import { checkSelfReferralEmail, checkPaymentMethodOverlap, resolveBuyerFingerprint } from "../selfReferral";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { recordTrackingVerified } from "@/lib/tracking";
import { REFERRAL_METADATA_KEY } from "@/lib/referral";
import { claimFirstPayment, idOf, recordReferredSubscription, subscriptionProductIds } from "../referredSubscription";
import { referralStillEarns } from "../referralDuration";
import { createCommissionUnlessSelfReferral } from "../recordCommission";

export async function handleCheckoutSessionCompleted(merchant: Merchant, session: Stripe.Checkout.Session): Promise<void> {
  const referralToken = session.metadata?.[REFERRAL_METADATA_KEY];
  if (!referralToken) return; // not a Supaffi-tracked checkout

  // Scoped to the Merchant whose webhook this is. A token is just a string in
  // Session metadata, so one minted for another Merchant's affiliate must not
  // earn a commission on this Merchant's sale.
  const click = await db.click.findUnique({
    where: { referralToken, affiliate: { merchantId: merchant.id } },
    include: { affiliate: { include: { program: true } } },
  });
  if (!click) return; // token doesn't match one of this Merchant's Clicks

  // A stale/reused token past its Attribution Window doesn't count, even
  // on the very first purchase.
  const completedAt = new Date(session.created * 1000);
  if (click.expiresAt < completedAt) return;

  // Reaching here proves both halves of the tracking integration at once: a
  // Click existed, so the script is live on the Merchant's site, and the token
  // came back on the Session, so their checkout code passes it through.
  // Recorded before the exclusion and self-referral
  // checks below, because those decide whether this sale earns a commission,
  // not whether the integration works.
  await recordTrackingVerified(merchant.id);

  // The Owner confirmed a self referral that came through this click. Nothing
  // it brings earns again: not this purchase, and not the subscription it
  // would start. Checked after the tracking proof above, because the
  // integration itself still worked.
  if (click.fraudConfirmedAt) return;

  // A delayed payment method (SEPA, ACH, Boleto) completes the Session before
  // any money has moved, and the payment can still fail. Nothing happens yet,
  // not even recording the subscription:
  // checkout.session.async_payment_succeeded brings this same Session back
  // through here, paid, once it settles.
  if (session.payment_status === "unpaid") return;

  const stripeCustomerId = idOf(session.customer);
  const subscriptionId = idOf(session.subscription);
  const invoiceId = idOf(session.invoice);
  const paymentIntentId = idOf(session.payment_intent);
  // For subscription-mode sessions this is the invoice; for one-time
  // "payment"-mode sessions there is no Invoice at all, so the
  // PaymentIntent ID is stored instead. chargeRefunded.ts knows to fall
  // back to this when a Charge has no traceable Invoice.
  const stripePaymentRef = invoiceId ?? paymentIntentId;

  // A free trial, or a first month discounted to nothing, completes with no
  // money on it. Stripe reports that either as no_payment_required or as paid
  // with a zero total. Neither is the subscription's first payment; the first
  // invoice that charges money is.
  const moneyPaid = session.payment_status === "paid" && (session.amount_total ?? 0) > 0;

  // Renewals earn by matching the subscription this Checkout created, never
  // the customer: products sharing a Stripe account share customers, and a
  // customer's other subscriptions were never referred. Recorded before the
  // exclusion check below, because excluding this one purchase does not
  // exclude the renewals after it, and recorded for a free trial too, so the
  // trial's first paid invoice can earn. The first payment is claimed even
  // when this sale earns nothing, because it is when money first moved.
  if (subscriptionId) {
    // Its renewals earn only on the products it bills, so they are read now,
    // before anything is written: a Stripe outage throws and the retried
    // event records the row whole. A key that cannot answer records none, and
    // the first renewal fills them. A redelivery whose row already carries
    // products skips the read entirely: the write-once guard would keep the
    // data safe either way, but there is no reason to spend the Stripe call
    // or retry a redelivery on a transient failure that changes nothing.
    const existing = await db.referredSubscription.findUnique({
      where: { merchantId_stripeSubscriptionId: { merchantId: merchant.id, stripeSubscriptionId: subscriptionId } },
    });
    const products =
      existing && existing.stripeProductIds.length > 0
        ? existing.stripeProductIds
        : await subscriptionProductIds(stripeClientFor(merchant), subscriptionId);
    const referred = await recordReferredSubscription(
      merchant.id,
      click.id,
      subscriptionId,
      products === "unanswered" ? [] : products
    );
    if (moneyPaid && stripePaymentRef) {
      // A delayed payment method's Session is created unpaid, and
      // checkout.session.async_payment_succeeded brings it back, paid, once
      // the debit clears days later. The first payment is still dated from
      // the Session's own creation time, not that later event: Stripe starts
      // the subscription, and schedules every renewal, from the Session, so a
      // FIXED_MONTHS window measured from the settlement date would end one
      // renewal late and let the month N+1 invoice earn.
      await claimFirstPayment(referred, { ref: stripePaymentRef, at: completedAt });
    }
  }

  // Idempotency rides on Commission.stripePaymentRef being unique. A session
  // with neither an invoice nor a payment intent gives us no key, and a
  // redelivery would duplicate. Nothing was paid on such a session anyway.
  if (!stripePaymentRef) return;

  // One duration per referral. A new Checkout through the same click, to
  // subscribe again or to move to another plan, earns only what the click's
  // first payment still allows: nothing more on a one-time program, and only
  // inside the months counted from that first payment on a fixed-months one.
  // Checked after the subscription above claimed its first payment, so the
  // click's very first sale is measured against itself, and before any Stripe
  // call, so a sale that cannot earn costs none.
  const sale = { ref: stripePaymentRef, at: completedAt };
  if (!(await referralStillEarns(merchant.id, click.id, click.affiliate.program, sale))) return;

  const stripe = stripeClientFor(merchant);

  // "no_payment_required" (a free trial) still recorded its subscription
  // above, so the first paid invoice earns through invoice.paid, but there is
  // no money on this Session to take a commission from.
  if (session.payment_status !== "paid") return;
  if (!session.currency) return;

  // Earned on the sale before tax and shipping, see saleBase.ts. A Session
  // that does not say how much tax it carried is logged and skipped rather
  // than paid on a total that still has the tax in it; returning normally
  // marks the event processed instead of retrying something that will never
  // change.
  const baseMinor = checkoutSessionBaseMinor(session);
  if (baseMinor === null) {
    console.error(`[worker] session ${session.id} carries no tax breakdown, so no commission was recorded for it`);
    return;
  }

  const affiliate = click.affiliate;
  const program = affiliate.program;
  const rate = commissionRateFor(affiliate, program);
  const amount = computeCommissionAmount(baseMinor, session.currency, rate);
  // A sale that came to nothing, or to less than a cent of commission, would
  // only add an empty row to both ledgers.
  if (amount.lte(0)) return;

  // The flag can sit on the invoice, the subscription or the customer, and the
  // Session's event is minimal and carries none of their metadata. Read only
  // once the sale would earn, so a free trial or a sale that comes to nothing
  // costs no call, and before the card and charge reads below, which an
  // excluded sale does not need. The invoice is read with its subscription and
  // customer expanded, so one call answers all three. A read that fails
  // throws, so the event is retried rather than earning on a sale the merchant
  // may have excluded.
  const invoiceRead = invoiceId ? await retrieveInvoiceForEarning(stripe, invoiceId) : null;
  const excluded = await isExcluded(
    stripe,
    invoiceRead
      ? exclusionSourcesOf(invoiceRead, subscriptionId, stripeCustomerId)
      : { subscription: subscriptionId, customer: stripeCustomerId },
    stripePaymentRef
  );
  if (excluded) return;

  let flagReason = checkSelfReferralEmail(affiliate, session.customer_details?.email ?? null);
  if (!flagReason) {
    const fingerprint = await resolveBuyerFingerprint(stripe, session);
    flagReason = await checkPaymentMethodOverlap(stripe, affiliate, fingerprint, stripeCustomerId);
  }

  // A refund or a dispute made before this event was processed has already
  // been and gone unapplied, so both are read back from the charge now and
  // folded into the row.
  const chargeIntentId = paymentIntentId ?? (invoiceId ? await paymentIntentForInvoice(stripe, invoiceId) : null);
  const charge = chargeIntentId ? await latestChargeFor(stripe, chargeIntentId) : null;
  const dispute = await disputeStateAtCreation(stripe, chargeIntentId, charge);

  try {
    // Checked against a self referral confirmed since the check above.
    const written = await createCommissionUnlessSelfReferral({
      data: {
        affiliateId: affiliate.id,
        clickId: click.id,
        stripePaymentRef,
        currency: session.currency,
        saleAmount: saleAmountFor(baseMinor, session.currency),
        payableAt: computePayableAt(program),
        flagReason,
        // amount, grossAmount (the figure a later refund prorates against),
        // status, voidedAt, voidReason and disputeOpenedAt.
        ...commissionFieldsAtCreation({ amount, flagReason, charge, dispute }),
      },
    });
    if (written && dispute === "unknown") {
      // The write only reports whether it happened, not the row: looked up by
      // its unique payment reference so the log still names the commission.
      const commission = await db.commission.findFirst({ where: { stripePaymentRef }, select: { id: true } });
      console.warn(
        `[worker] commission ${commission?.id} was created while its disputes could not be read, so it is held until a dispute event or the owner releases it.`
      );
    }
  } catch (err) {
    // Unique constraint on stripePaymentRef. checkout.session.completed and
    // checkout.session.async_payment_succeeded can both land on the same
    // paid Session; whichever arrives second finds the Commission the first
    // one already created, not an error.
    if (!isUniqueConstraintError(err)) throw err;
  }
}
