import type { Merchant, Prisma, ReferredSubscription } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeClientFor } from "@/lib/stripe";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import type { PaymentRef } from "./commission";

const WITH_CLICK = {
  click: { include: { affiliate: { include: { program: true } } } },
} satisfies Prisma.ReferredSubscriptionInclude;

export type ReferredSubscriptionWithClick = Prisma.ReferredSubscriptionGetPayload<{
  include: typeof WITH_CLICK;
}>;

// A legacy click can hold commissions from several purchases. Looking at more
// than a few would turn one renewal into a burst of Stripe calls, and the
// invoice a referred checkout created is almost always among its first.
const LEGACY_INVOICES_CHECKED = 3;

// Stripe could not answer right now, and asking again later can succeed.
const RETRYABLE_STRIPE_ERRORS = new Set(["StripeConnectionError", "StripeRateLimitError", "StripeAPIError"]);

// The Merchant's key cannot read invoices. Fixing the key fixes the answer, so
// the check is left unrecorded for a later event to run again.
const KEY_STRIPE_ERRORS = new Set(["StripePermissionError", "StripeAuthenticationError"]);

/** Stripe fields are either an id or the expanded object carrying it. */
export function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * The subscription an invoice belongs to, or null for a one-off invoice.
 *
 * Supaffi does not choose the API version of a Merchant's webhook endpoint, so
 * both shapes arrive. Since 2025-03-31.basil the id lives under
 * `parent.subscription_details`; before it, Stripe sent a top-level
 * `subscription` field that the bundled SDK types no longer declare.
 */
export function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  if (invoice.parent?.type === "subscription_details") {
    const id = idOf(invoice.parent.subscription_details?.subscription);
    if (id) return id;
  }
  const legacy = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
  return idOf(legacy);
}

/**
 * Records that a referred Checkout Session created this subscription. A
 * redelivered or retried checkout lands on the row already there.
 */
export async function recordReferredSubscription(
  merchantId: string,
  clickId: string,
  stripeSubscriptionId: string
): Promise<ReferredSubscription> {
  try {
    return await db.referredSubscription.create({ data: { merchantId, clickId, stripeSubscriptionId } });
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    return db.referredSubscription.findUniqueOrThrow({
      where: { merchantId_stripeSubscriptionId: { merchantId, stripeSubscriptionId } },
    });
  }
}

/**
 * The referral behind a subscription on this Merchant, or null when nobody
 * referred it.
 *
 * Scoped to the Merchant whose webhook this is. Products sharing a Stripe
 * account each receive a copy of every event, and only the product whose
 * referred checkout created the subscription has a row for it.
 */
export async function findReferredSubscription(
  merchant: Merchant,
  stripeSubscriptionId: string,
  stripeCustomerId: string | null
): Promise<ReferredSubscriptionWithClick | null> {
  const where = { merchantId_stripeSubscriptionId: { merchantId: merchant.id, stripeSubscriptionId } };
  const found = await db.referredSubscription.findUnique({ where, include: WITH_CLICK });
  if (found || !stripeCustomerId) return found;
  if (!(await recognizeLegacyClick(merchant, stripeCustomerId))) return null;
  return db.referredSubscription.findUnique({ where, include: WITH_CLICK });
}

/**
 * Retrieves one invoice while recognising a legacy click. An invoice Stripe no
 * longer has is an answer: it proves nothing, so it resolves to null. An
 * outage throws, so the webhook is retried rather than a renewal dropped for
 * good. A key that cannot read invoices returns "unanswered", so nothing is
 * recorded and the next event asks again once the key is fixed. Anything else
 * is unexpected and throws too, rather than being recorded as a finished check.
 */
async function retrieveLegacyInvoice(
  stripe: Stripe,
  clickId: string,
  invoiceId: string
): Promise<Stripe.Invoice | null | "unanswered"> {
  try {
    return await stripe.invoices.retrieve(invoiceId);
  } catch (err) {
    const { type, code } = err as { type?: string; code?: string };
    if (code === "resource_missing") return null;
    if (type && KEY_STRIPE_ERRORS.has(type)) {
      console.warn(
        `[worker] click ${clickId}: the Stripe key could not read invoices, so its referral is checked again on its next event`
      );
      return "unanswered";
    }
    throw err;
  }
}

/**
 * Recognises the subscription a click referred before 0.2.5, when the first
 * checkout stored only the customer on the click and no subscription id existed
 * to backfill. Runs at most once per click: `legacyCheckedAt` records that the
 * check finished, whatever it found. Returns whether it adopted anything.
 *
 * The customer alone is not proof: products on a shared Stripe account share
 * customers, so a legacy click can hold commissions on another product's
 * renewals, and a customer can start subscriptions nobody referred. Only a
 * subscription created inside a referred checkout earns, so a subscription is
 * adopted only from an invoice with billing_reason subscription_create among
 * the click's earliest invoice commissions. That is the invoice a checkout
 * creates; a renewal invoice proves nothing. A free trial whose checkout wrote
 * no commission is therefore never recognised.
 *
 * The first payment is the earliest retrieved invoice of that subscription
 * that charged money, dated by the invoice, not by the commission row.
 */
async function recognizeLegacyClick(merchant: Merchant, stripeCustomerId: string): Promise<boolean> {
  const click = await db.click.findFirst({
    where: { stripeCustomerId, legacyCheckedAt: null, affiliate: { merchantId: merchant.id } },
    select: {
      id: true,
      commissions: {
        where: { adjustsCommissionId: null, stripePaymentRef: { startsWith: "in_" } },
        orderBy: { createdAt: "asc" },
        take: LEGACY_INVOICES_CHECKED,
        select: { stripePaymentRef: true },
      },
    },
  });
  if (!click) return false;

  const invoices: Stripe.Invoice[] = [];
  if (click.commissions.length > 0) {
    const stripe = stripeClientFor(merchant);
    for (const { stripePaymentRef } of click.commissions) {
      if (!stripePaymentRef) continue;
      const invoice = await retrieveLegacyInvoice(stripe, click.id, stripePaymentRef);
      if (invoice === "unanswered") return false;
      if (invoice) invoices.push(invoice);
    }
  }

  const adopted = [
    ...new Set(
      invoices
        .filter((invoice) => invoice.billing_reason === "subscription_create")
        .map(subscriptionIdOf)
        .filter((id): id is string => id !== null)
    ),
  ];

  for (const stripeSubscriptionId of adopted) {
    const firstPaid = invoices
      .filter((invoice) => subscriptionIdOf(invoice) === stripeSubscriptionId && invoice.amount_paid > 0)
      .sort((a, b) => a.created - b.created)[0];
    try {
      await db.referredSubscription.create({
        data: {
          merchantId: merchant.id,
          clickId: click.id,
          stripeSubscriptionId,
          firstPaymentRef: firstPaid?.id ?? null,
          firstPaidAt: firstPaid ? new Date(firstPaid.created * 1000) : null,
        },
      });
    } catch (err) {
      // Another event for the same customer recognised it a moment earlier.
      if (!isUniqueConstraintError(err)) throw err;
    }
  }

  await db.click.update({ where: { id: click.id }, data: { legacyCheckedAt: new Date() } });
  return adopted.length > 0;
}

/**
 * Records `payment` as the subscription's first payment unless one is already
 * recorded, and returns whichever is first.
 *
 * The write only lands while the column is still empty, so two events racing
 * cannot both claim it, and a retried event whose commission failed to save
 * still recognises its own payment as the first.
 */
export async function claimFirstPayment(
  referred: { id: string; firstPaymentRef: string | null; firstPaidAt: Date | null },
  payment: PaymentRef
): Promise<PaymentRef> {
  if (referred.firstPaymentRef && referred.firstPaidAt) {
    return { ref: referred.firstPaymentRef, at: referred.firstPaidAt };
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
