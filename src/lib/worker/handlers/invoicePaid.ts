import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeClientFor } from "@/lib/stripe";
import {
  commissionRateFor,
  computeCommissionAmount,
  computePayableAt,
  isExcluded,
  isWithinCommissionDuration,
  saleAmountFor,
} from "../commission";
import { commissionFieldsAtCreation, latestChargeFor, paymentIntentForInvoice } from "../paymentState";
import { invoiceBaseMinor } from "../saleBase";
import { checkSelfReferralEmail } from "../selfReferral";
import { isUniqueConstraintError } from "@/lib/prismaErrors";

export async function handleInvoicePaid(merchant: Merchant, invoice: Stripe.Invoice): Promise<void> {
  const stripeCustomerId =
    typeof invoice.customer === "string" ? invoice.customer : (invoice.customer?.id ?? null);
  if (!stripeCustomerId) return;

  // The first invoice on a new subscription is handled by
  // checkout.session.completed (matched via the Referral Token, which the
  // first invoice doesn't carry). Renewals only, here.
  if (invoice.billing_reason === "subscription_create") return;

  // Scoped to the Merchant whose webhook this is. Customer ids are only
  // unique per Stripe account, and one Instance hosts several Merchants, so
  // an unscoped match could pay one Merchant's affiliate for another's sale.
  const click = await db.click.findUnique({
    where: { stripeCustomerId, affiliate: { merchantId: merchant.id } },
    include: { affiliate: { include: { program: true } } },
  });
  if (!click) return; // this Customer was never attributed to one of this Merchant's Affiliates

  const program = click.affiliate.program;
  const chargedAt = new Date(invoice.created * 1000);
  if (!isWithinCommissionDuration(program, click.createdAt, chargedAt)) return;

  const stripe = stripeClientFor(merchant);
  const subscriptionMetadata =
    invoice.parent?.type === "subscription_details"
      ? (invoice.parent.subscription_details?.metadata ?? null)
      : null;

  const excluded = await isExcluded(stripe, {
    invoiceMetadata: invoice.metadata,
    subscriptionMetadata,
    customerId: stripeCustomerId,
  });
  if (excluded) return;

  if (!invoice.currency) return;

  // Earned on the renewal before tax and shipping, scaled to what was paid in
  // money, see saleBase.ts. An invoice that does not say how much tax it
  // carried is logged and skipped rather than paid on a total with the tax in
  // it; returning normally stops a retry that could never succeed.
  const baseMinor = invoiceBaseMinor(invoice);
  if (baseMinor === null) {
    console.error(`[worker] invoice ${invoice.id} carries no tax breakdown, so no commission was recorded for it`);
    return;
  }

  const affiliate = click.affiliate;
  const rate = commissionRateFor(affiliate, program);
  const amount = computeCommissionAmount(baseMinor, invoice.currency, rate);
  // A renewal covered by credit balance or discounted to nothing used to
  // leave a 0.00 row in both ledgers.
  if (amount.lte(0)) return;
  const flagReason = checkSelfReferralEmail(affiliate, invoice.customer_email);

  // A refund made before this event was processed is read back from the
  // charge now and folded into the row, see paymentState.ts.
  const chargeIntentId = await paymentIntentForInvoice(stripe, invoice.id);
  const charge = chargeIntentId ? await latestChargeFor(stripe, chargeIntentId) : null;

  try {
    await db.commission.create({
      data: {
        affiliateId: affiliate.id,
        clickId: click.id,
        stripePaymentRef: invoice.id,
        currency: invoice.currency,
        saleAmount: saleAmountFor(baseMinor, invoice.currency),
        payableAt: computePayableAt(program),
        flagReason,
        // amount, grossAmount (the figure a later refund prorates against),
        // status, voidedAt and voidReason.
        ...commissionFieldsAtCreation({ amount, flagReason, charge }),
      },
    });
  } catch (err) {
    // Redelivery of the same invoice.paid event.
    if (!isUniqueConstraintError(err)) throw err;
  }
}
