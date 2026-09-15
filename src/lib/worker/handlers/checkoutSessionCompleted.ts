import type { Merchant, ReferredSubscription } from "@prisma/client";
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
import { referredEarningOn, storableReferredShare } from "../referredEarning";
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

  const stripe = stripeClientFor(merchant);

  // A Session with no money on it (a free trial, a first month discounted to
  // nothing, or a billing cycle anchor that bills later) reads nothing here.
  const moneyOnSession = session.payment_status === "paid" && (session.amount_total ?? 0) > 0;

  // A subscription's first payment is judged on its invoice, never on the
  // Session's totals: credit balance can pay part or all of it, money can be
  // recorded as paid outside Stripe, and a one-off item can ride on it, and
  // the Session says none of that. Read with its subscription and customer
  // expanded, before anything is written, so a failed read retries the event
  // from a clean start.
  const firstInvoice =
    session.mode === "subscription" && invoiceId && moneyOnSession
      ? await retrievePaidFirstInvoice(stripe, session.id, invoiceId)
      : null;

  // The first invoice that moved money is the subscription's first payment, as
  // invoicePaid.ts already decides. One paid entirely from credit balance moved
  // none, so it is not claimed and the next paid invoice starts the referral.
  const moneyPaid = firstInvoice ? firstInvoice.amount_paid > 0 : session.mode !== "subscription" && moneyOnSession;

  // Renewals earn by matching the subscription this Checkout created, never
  // the customer: products sharing a Stripe account share customers, and a
  // customer's other subscriptions were never referred. Recorded before the
  // exclusion check below, because excluding this one purchase does not
  // exclude the renewals after it, and recorded for a free trial too, so the
  // trial's first paid invoice can earn. The first payment is claimed even
  // when this sale earns nothing, because it is when money first moved.
  let referred: ReferredSubscription | null = null;
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
    referred = await recordReferredSubscription(
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

  // A paid subscription Session is documented to name its invoice once it
  // completes. If one ever does not, nothing on it can be judged the way a
  // renewal is, and the Session's own totals may include credit balance, so
  // it earns nothing; its first paid renewal claims the first payment.
  if (session.mode === "subscription" && moneyOnSession && (!firstInvoice || !subscriptionId || !referred)) {
    console.error(
      `[worker] session ${session.id} started a paid subscription whose first payment could not be identified, so no commission was recorded for it`
    );
    return;
  }
  // Paid entirely from credit balance: nothing moved, so nothing earns.
  if (firstInvoice && !moneyPaid) return;

  // Idempotency rides on Commission.stripePaymentRef being unique. A session
  // with neither an invoice nor a payment intent gives us no key, and a
  // redelivery would duplicate. Nothing was paid on such a session anyway.
  if (!stripePaymentRef) return;

  // One duration per referral. A new Checkout through the same click, to
  // subscribe again or to move to another plan, earns only what the click's
  // first payment still allows: nothing more on a one-time program, and only
  // inside the months counted from that first payment on a fixed-months one.
  // Checked after the subscription above claimed its first payment, so the
  // click's very first sale is measured against itself, and before the line,
  // tax and exclusion reads below, so a sale that cannot earn costs none of
  // them. A subscription's first invoice is read above it, because whether
  // money moved decides whether its first payment is claimed.
  const sale = { ref: stripePaymentRef, at: completedAt };
  if (!(await referralStillEarns(merchant.id, click.id, click.affiliate.program, sale))) return;

  // "no_payment_required" (a free trial) still recorded its subscription
  // above, so the first paid invoice earns through invoice.paid, but there is
  // no money on this Session to take a commission from.
  if (session.payment_status !== "paid") return;
  if (!session.currency) return;

  // A zero-rate affiliate earns nothing no matter what the sale comes to, so
  // the rate is checked before the base is computed: a one-time purchase's
  // base needs a Stripe read of its own (see below), and there is no reason
  // to spend it on a sale that cannot pay anything.
  const affiliate = click.affiliate;
  const program = affiliate.program;
  const rate = commissionRateFor(affiliate, program);
  if (rate <= 0) return;

  // Earned on the sale before tax and shipping. A subscription's first payment
  // follows the renewal rule exactly: only the subscription's own lines for
  // the products its referral bought, before tax, scaled to what was paid
  // through Stripe, see referredEarning.ts. A one-time price sold in the same
  // Checkout lands on that first invoice as a one-off line, which Stripe's
  // line shape does not tell apart from an item the merchant left pending on
  // the customer, so it earns nothing, as on a renewal. A one-time purchase
  // earns on the Session, see saleBase.ts. A payload that does not say how
  // much tax it carried is logged and skipped rather than paid on a total that
  // still has the tax in it; returning normally marks the event processed
  // instead of retrying something that will never change.
  let baseMinor: number;
  let referredChargeMinor: number | null = null;
  let sessionRead: Stripe.Checkout.Session | null = null;
  if (firstInvoice && subscriptionId && referred) {
    // The first invoice came back with its subscription and customer
    // expanded, so this check costs no call, and it runs before the lines are
    // listed, which an excluded sale does not need. A subscription or customer
    // Stripe left unexpanded is read, and a failed read throws, so the event
    // is retried rather than earning on a sale the merchant may have excluded.
    if (await isExcluded(stripe, exclusionSourcesOf(firstInvoice, subscriptionId, stripeCustomerId), stripePaymentRef)) return;
    if (typeof firstInvoice.amount_paid_off_stripe !== "number") {
      // Asked for and not answered, which this pinned API version is not
      // documented to do. Scaling on amount_paid alone could pay on money
      // moved outside Stripe.
      console.error(
        `[worker] invoice ${firstInvoice.id} did not answer amount_paid_off_stripe when read with expand, so no commission was recorded for it`
      );
      return;
    }
    const earned = await referredEarningOn(stripe, firstInvoice.id, firstInvoice, subscriptionId, referred);
    if (!earned) return;
    baseMinor = earned.baseMinor;
    referredChargeMinor = earned.referredChargeMinor;
  } else if (session.mode === "payment") {
    // A one-time purchase. The tax breakdown is only returned when asked for,
    // so the Session is read back with it, and with the customer and invoice
    // the exclusion check below needs.
    sessionRead = await retrieveSessionForEarning(stripe, session.id);
    if (!sessionRead) return;
    const sessionBase = checkoutSessionBaseMinor(sessionRead);
    if (sessionBase === null) {
      console.error(`[worker] session ${session.id} carries no tax breakdown, so no commission was recorded for it`);
      return;
    }
    baseMinor = sessionBase;
  } else {
    // A subscription Session with nothing paid on it yet: session.mode ===
    // "subscription" only reaches here when moneyOnSession is false (a free
    // trial, or a billing cycle anchor that bills later), since any paid
    // subscription Session either returned above or took the invoice branch.
    // Nothing was charged, so there is nothing to read a breakdown for.
    baseMinor = 0;
  }

  const amount = computeCommissionAmount(baseMinor, session.currency, rate);
  // A sale that came to nothing, or to less than a cent of commission, would
  // only add an empty row to both ledgers.
  if (amount.lte(0)) return;

  if (sessionRead) {
    // A one-time purchase. Its post-purchase invoice and its customer came
    // back expanded on the Session read above, so this check costs no
    // further call, and it runs before the card and charge reads below.
    // Anything Stripe left as an id is read, and a read that fails throws, so
    // the event is retried rather than earning on a sale the merchant may
    // have excluded.
    const excluded = await isExcluded(
      stripe,
      { invoice: sessionRead.invoice ?? invoiceId, customer: sessionRead.customer ?? stripeCustomerId },
      stripePaymentRef
    );
    if (excluded) return;
  }

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

  // Never more than the charge itself, as on a renewal.
  const cappedReferredChargeMinor =
    referredChargeMinor !== null && charge ? Math.min(referredChargeMinor, charge.amount) : referredChargeMinor;

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
        // Stored through storableReferredShare exactly as invoicePaid.ts
        // does, matching renewals: a bigint column, never a null/too-large
        // fallback, since a documented Stripe amount cannot overflow it.
        referredChargeMinor: cappedReferredChargeMinor !== null ? storableReferredShare(cappedReferredChargeMinor) : null,
        // amount, grossAmount (the figure a later refund prorates against),
        // status, voidedAt, voidReason and disputeOpenedAt.
        ...commissionFieldsAtCreation({ amount, flagReason, charge, dispute, referredChargeMinor: cappedReferredChargeMinor }),
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

/**
 * The first invoice of a paid subscription Checkout, read with the earning
 * expansions, once Stripe says it is paid.
 *
 * Throws rather than returning a fallback. The only fallback left is the
 * Session's total, which earns on credit balance the customer never paid, and
 * an invoice that is not paid yet does not carry its final amount_paid. A
 * thrown error sends the event back for a retry with backoff, and the error
 * names the invoice for the operator.
 */
async function retrievePaidFirstInvoice(stripe: Stripe, sessionId: string, invoiceId: string): Promise<Stripe.Invoice> {
  let invoice: Stripe.Invoice;
  try {
    invoice = await retrieveInvoiceForEarning(stripe, invoiceId);
  } catch (err) {
    throw new Error(
      `[worker] could not read invoice ${invoiceId} for session ${sessionId}, so the event is retried: ${(err as Error).message}`,
      { cause: err }
    );
  }
  if (invoice.status !== "paid") {
    throw new Error(`[worker] invoice ${invoiceId} for session ${sessionId} is ${invoice.status}, not paid yet, so the event is retried`);
  }
  return invoice;
}

/**
 * A one-time purchase's Session with its tax breakdown, customer and invoice.
 *
 * `total_details.breakdown` is "expandable (can be expanded into an object
 * with the expand request parameter)" (Stripe docs, Checkout Session object),
 * so it never arrives on the webhook payload itself and has to be read back.
 *
 * Almost every failure throws, so the event retries: Stripe unreachable, rate
 * limiting and an API error already did before, and now so does a missing
 * permission, a bad key, or any other invalid request. "If a restricted API
 * key doesn't have the correct permissions to complete an API request, Stripe
 * returns an invalid request error" (Stripe docs, restricted-api-keys.md), and
 * the Node error reference lists that alongside `StripePermissionError` ("The
 * API key used for this request does not have the required permissions") and
 * `StripeAuthenticationError` ("Stripe can't authenticate you with the
 * information provided") (Stripe docs, error-handling.md). A key made before
 * 0.2.7, without Checkout Sessions read, fails this way; throwing instead of
 * logging once means its one-time sales retry and earn once the key is
 * replaced, rather than being lost the moment the key first failed.
 *
 * Only Stripe answering `code: "resource_missing"` is logged and treated as
 * null: the Session itself no longer exists, so no key fix and no retry can
 * make it earn.
 */
async function retrieveSessionForEarning(stripe: Stripe, sessionId: string): Promise<Stripe.Checkout.Session | null> {
  try {
    return await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["total_details.breakdown", "customer", "invoice"],
    });
  } catch (err) {
    const { type, code } = err as { type?: string; code?: string };
    if (code !== "resource_missing") throw err;
    console.error(`[worker] session ${sessionId} no longer exists on Stripe (${type ?? "unknown"}/${code}), so no commission was recorded for it`);
    return null;
  }
}
