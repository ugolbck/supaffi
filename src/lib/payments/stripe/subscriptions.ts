import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeClientFor } from "@/lib/payments/stripe/client";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { referredSubscriptionFor, type ReferredSubscriptionWithClick } from "@/lib/worker/referredSubscription";

// A legacy click can hold commissions from several purchases. Looking at more
// than a few would turn one renewal into a burst of Stripe calls, and the
// invoice a referred checkout created is almost always among its first.
const LEGACY_INVOICES_CHECKED = 3;

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

// Stripe caps a list page at 100.
const ITEMS_PAGE_SIZE = 100;

/**
 * The Stripe products a subscription bills now, read from its items, each
 * once and sorted.
 *
 * Read from the subscription rather than from the Checkout Session's line
 * items: a one-time price sold in the same Checkout is not a subscription
 * item, and the key reads subscriptions but not Checkout Sessions. The read
 * goes through Supaffi's pinned API version, so the shape is always the one
 * the SDK types describe.
 *
 * A key that cannot read subscriptions, or a subscription Stripe no longer
 * has, answers "unanswered" with one warning: the products are then taken
 * from the subscription's next renewal. Anything else throws, so the event is
 * retried.
 */
export async function subscriptionProductIds(
  stripe: Stripe,
  subscriptionId: string
): Promise<string[] | "unanswered"> {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const items = [...subscription.items.data];
    let hasMore = subscription.items.has_more;
    while (hasMore && items.length > 0) {
      const page = await stripe.subscriptionItems.list({
        subscription: subscriptionId,
        limit: ITEMS_PAGE_SIZE,
        starting_after: items[items.length - 1].id,
      });
      items.push(...page.data);
      hasMore = page.has_more && page.data.length > 0;
    }
    const products = items.map((item) => idOf(item.price.product)).filter((id): id is string => id !== null);
    return [...new Set(products)].sort();
  } catch (err) {
    const { type, code } = err as { type?: string; code?: string };
    if (code === "resource_missing" || (type && KEY_STRIPE_ERRORS.has(type))) {
      console.warn(
        `[worker] subscription ${subscriptionId}: Stripe could not say which products it bills, so they are taken from its next renewal`
      );
      return "unanswered";
    }
    throw err;
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
  subscriptionRef: string,
  stripeCustomerId: string | null
): Promise<ReferredSubscriptionWithClick | null> {
  const found = await referredSubscriptionFor(merchant.id, subscriptionRef);
  if (found || !stripeCustomerId) return found;
  await recognizeLegacyClick(merchant, stripeCustomerId);
  // Looked up again whatever recognition did. Another event may have finished
  // the check for this click a moment earlier and adopted the subscription, in
  // which case this one finds no unchecked click but the row now exists.
  return referredSubscriptionFor(merchant.id, subscriptionRef);
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
 * check finished, whatever it found. A click whose self referral the Owner
 * confirmed adopts nothing, since nothing it brings earns.
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
async function recognizeLegacyClick(merchant: Merchant, stripeCustomerId: string): Promise<void> {
  const click = await db.click.findFirst({
    where: {
      stripeCustomerId,
      legacyCheckedAt: null,
      fraudConfirmedAt: null,
      affiliate: { merchantId: merchant.id },
    },
    select: {
      id: true,
      commissions: {
        where: { adjustsCommissionId: null, paymentRef: { startsWith: "in_" } },
        orderBy: { createdAt: "asc" },
        take: LEGACY_INVOICES_CHECKED,
        select: { paymentRef: true },
      },
    },
  });
  if (!click) return;

  const invoices: Stripe.Invoice[] = [];
  const stripe = click.commissions.length > 0 ? stripeClientFor(merchant) : null;
  if (stripe) {
    for (const { paymentRef } of click.commissions) {
      if (!paymentRef) continue;
      const invoice = await retrieveLegacyInvoice(stripe, click.id, paymentRef);
      if (invoice === "unanswered") return;
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

  for (const subscriptionRef of adopted) {
    const firstPaid = invoices
      .filter((invoice) => subscriptionIdOf(invoice) === subscriptionRef && invoice.amount_paid > 0)
      .sort((a, b) => a.created - b.created)[0];
    // What it bills now, which is what its checkout bought unless the plan
    // changed since. Left empty when Stripe cannot say; the next renewal fills it.
    const products = stripe ? await subscriptionProductIds(stripe, subscriptionRef) : "unanswered";
    try {
      await db.referredSubscription.create({
        data: {
          merchantId: merchant.id,
          clickId: click.id,
          subscriptionRef,
          firstPaymentRef: firstPaid?.id ?? null,
          firstPaidAt: firstPaid ? new Date(firstPaid.created * 1000) : null,
          productRefs: products === "unanswered" ? [] : products,
        },
      });
    } catch (err) {
      // Another event for the same customer recognised it a moment earlier.
      if (!isUniqueConstraintError(err)) throw err;
    }
  }

  await db.click.update({ where: { id: click.id }, data: { legacyCheckedAt: new Date() } });
}
