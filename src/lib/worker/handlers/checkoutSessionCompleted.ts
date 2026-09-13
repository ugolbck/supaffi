import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeClientFor } from "@/lib/stripe";
import { commissionRateFor, computeCommissionAmount, computePayableAt, isExcluded, saleAmountFor } from "../commission";
import { commissionFieldsAtCreation, latestChargeFor, paymentIntentForInvoice } from "../paymentState";
import { checkoutSessionBaseMinor } from "../saleBase";
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

  // A delayed payment method (SEPA, ACH, Boleto) completes the Session before
  // any money has moved, and the payment can still fail. Nothing happens yet,
  // not even the customer link: checkout.session.async_payment_succeeded
  // brings this same Session back through here, paid, once it settles.
  if (session.payment_status === "unpaid") return;

  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);

  // Always link the Click to the Customer, even if this specific purchase
  // ends up excluded or flagged below — exclusion isn't retroactive or
  // blanket, a Merchant might exclude this one purchase but still want
  // ordinary renewals to earn commission later.
  //
  // Only the click that first brought this customer holds them. Renewals are
  // matched by customer id, so moving the link would silently reassign every
  // future renewal to whichever affiliate they clicked most recently.
  // The column is globally unique, so a second click's attempt would throw
  // anyway; refusing it here says why.
  if (stripeCustomerId && !click.stripeCustomerId) {
    try {
      await db.click.update({ where: { id: click.id }, data: { stripeCustomerId } });
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
    }
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

  // Idempotency rides on Commission.stripePaymentRef being unique. A session
  // with neither an invoice nor a payment intent gives us no key, and a
  // redelivery would duplicate. Nothing was paid on such a session anyway.
  if (!stripePaymentRef) return;

  const excluded = await isExcluded(stripe, {
    invoiceMetadata: null, // the Session doesn't embed Invoice metadata inline
    subscriptionMetadata: null,
    customerId: stripeCustomerId,
  });
  if (excluded) return;

  // "no_payment_required" (a free trial) still linked the customer above, so
  // the first real renewal earns through invoice.paid, but there is no money
  // on this Session to take a commission from.
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

  let flagReason = checkSelfReferralEmail(affiliate, session.customer_details?.email ?? null);
  if (!flagReason) {
    const fingerprint = await resolveBuyerFingerprint(stripe, session);
    flagReason = await checkPaymentMethodOverlap(stripe, affiliate, fingerprint, stripeCustomerId);
  }

  // A refund made before this event was processed has already been and gone
  // unapplied, so it is read back from the charge now and folded into the row.
  const chargeIntentId = paymentIntentId ?? (invoiceId ? await paymentIntentForInvoice(stripe, invoiceId) : null);
  const charge = chargeIntentId ? await latestChargeFor(stripe, chargeIntentId) : null;

  try {
    await db.commission.create({
      data: {
        affiliateId: affiliate.id,
        clickId: click.id,
        stripePaymentRef,
        currency: session.currency,
        saleAmount: saleAmountFor(baseMinor, session.currency),
        payableAt: computePayableAt(program),
        flagReason,
        // amount, grossAmount (the figure a later refund prorates against),
        // status, voidedAt and voidReason.
        ...commissionFieldsAtCreation({ amount, flagReason, charge }),
      },
    });
  } catch (err) {
    // Unique constraint on stripePaymentRef — an invoice.paid for this same
    // first invoice won the race (Stripe doesn't guarantee ordering between
    // the two events). The Commission already exists, not an error.
    if (!isUniqueConstraintError(err)) throw err;
  }
}
