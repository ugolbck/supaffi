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
} from "../commission";
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

  const click = await db.click.findUnique({
    where: { stripeCustomerId },
    include: { affiliate: { include: { program: true } } },
  });
  if (!click) return; // this Customer was never attributed to an Affiliate

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

  const affiliate = click.affiliate;
  const rate = commissionRateFor(affiliate, program);
  const amount = computeCommissionAmount(invoice.amount_paid, invoice.currency, rate);
  const flagReason = checkSelfReferralEmail(affiliate, invoice.customer_email);

  try {
    await db.commission.create({
      data: {
        affiliateId: affiliate.id,
        clickId: click.id,
        stripePaymentRef: invoice.id,
        amount,
        currency: invoice.currency,
        status: flagReason ? "FLAGGED" : "PENDING",
        payableAt: computePayableAt(program),
        flagReason,
      },
    });
  } catch (err) {
    // Redelivery of the same invoice.paid event.
    if (!isUniqueConstraintError(err)) throw err;
  }
}
