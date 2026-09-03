import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeClientFor } from "@/lib/stripe";
import { commissionRateFor, computeCommissionAmount, computePayableAt, isExcluded } from "../commission";
import { checkSelfReferralEmail, checkPaymentMethodOverlap, resolveBuyerFingerprint } from "../selfReferral";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { recordTrackingVerified } from "@/lib/tracking";
import { REFERRAL_METADATA_KEY } from "@/lib/referral";

export async function handleCheckoutSessionCompleted(
  merchant: Merchant,
  session: Stripe.Checkout.Session
): Promise<void> {
  const referralToken = session.metadata?.[REFERRAL_METADATA_KEY];
  if (!referralToken) return; // not a Supaffi-tracked checkout

  const click = await db.click.findUnique({
    where: { referralToken },
    include: { affiliate: { include: { program: true } } },
  });
  if (!click) return; // token doesn't match a known Click
  if (click.stripeCustomerId) return; // already processed — redelivery

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

  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);

  // Always link the Click to the Customer, even if this specific purchase
  // ends up excluded or flagged below — exclusion isn't retroactive or
  // blanket, a Merchant might exclude this one purchase but still want
  // ordinary renewals to earn commission later.
  if (stripeCustomerId) {
    await db.click.update({ where: { id: click.id }, data: { stripeCustomerId } });
  }

  const stripe = stripeClientFor(merchant);

  const invoiceId = typeof session.invoice === "string" ? session.invoice : (session.invoice?.id ?? null);
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  // For subscription-mode sessions this is the invoice; for one-time
  // "payment"-mode sessions there is no Invoice at all, so the
  // PaymentIntent ID is stored instead — chargeRefunded.ts knows to fall
  // back to this when a Charge has no traceable Invoice.
  const stripePaymentRef = invoiceId ?? paymentIntentId;

  const excluded = await isExcluded(stripe, {
    invoiceMetadata: null, // the Session doesn't embed Invoice metadata inline
    subscriptionMetadata: null,
    customerId: stripeCustomerId,
  });
  if (excluded) return;

  if (session.amount_total == null || !session.currency) return; // nothing paid, e.g. a $0 trial session

  const affiliate = click.affiliate;
  const program = affiliate.program;
  const rate = commissionRateFor(affiliate, program);
  const amount = computeCommissionAmount(session.amount_total, session.currency, rate);

  let flagReason = checkSelfReferralEmail(affiliate, session.customer_details?.email ?? null);
  if (!flagReason) {
    const fingerprint = await resolveBuyerFingerprint(stripe, session);
    flagReason = await checkPaymentMethodOverlap(stripe, affiliate, fingerprint, stripeCustomerId);
  }

  try {
    await db.commission.create({
      data: {
        affiliateId: affiliate.id,
        clickId: click.id,
        stripePaymentRef,
        amount,
        currency: session.currency,
        status: flagReason ? "FLAGGED" : "PENDING",
        payableAt: computePayableAt(program),
        flagReason,
      },
    });
  } catch (err) {
    // Unique constraint on stripePaymentRef — an invoice.paid for this same
    // first invoice won the race (Stripe doesn't guarantee ordering between
    // the two events). The Commission already exists, not an error.
    if (!isUniqueConstraintError(err)) throw err;
  }
}
