import type Stripe from "stripe";
import { fillStripeProductIds } from "./referredSubscription";
import { listInvoiceLines, referredInvoiceBase, type ReferredRevenue } from "./referredRevenue";

export type Earned = Extract<ReferredRevenue, { kind: "earned" }>;

type InvoiceFigures = Parameters<typeof referredInvoiceBase>[0];

// Logs the one line a non-earning outcome gets and reports whether the caller
// should stop. Shared by the first read and the recompute after a subscription
// learns its products, so a recompute that turns out unreadable or off Stripe
// is never quietly replaced by the stale figure computed before the fill.
function earnedOrLog(invoiceId: string, revenue: ReferredRevenue): Earned | null {
  if (revenue.kind === "no_tax_breakdown") {
    console.error(`[worker] invoice ${invoiceId} carries no tax breakdown, so no commission was recorded for it`);
    return null;
  }
  if (revenue.kind === "unreadable") {
    console.error(`[worker] invoice ${invoiceId} ${revenue.reason}, so no commission was recorded for it`);
    return null;
  }
  if (revenue.kind === "off_stripe") {
    // amount_paid already counts a payment made outside Stripe, so an invoice
    // paid entirely that way has nothing left to scale a commission on.
    console.warn(`[worker] invoice ${invoiceId} was paid outside Stripe, so no commission was recorded for it`);
    return null;
  }
  return revenue;
}

/**
 * What an invoice of a referred subscription earns on: only the subscription's
 * own lines for the products its referral bought, before tax, scaled to what
 * was paid through Stripe, see referredRevenue.ts. The same rule for the
 * subscription's first payment at checkout and for every renewal, so a
 * one-off item or credit balance never earns on either.
 *
 * An invoice whose tax or lines cannot be read is logged and earns nothing,
 * and the caller returns normally, since a retry could never succeed. A failed
 * read of the lines throws, so the event is retried. A subscription recorded
 * without its products keeps the ones this invoice bills from now on; if
 * another event stored a different set a moment earlier, this invoice is
 * measured against that.
 */
export async function referredEarningOn(
  stripe: Stripe,
  invoiceId: string,
  figures: InvoiceFigures,
  subscriptionId: string,
  referred: { id: string; stripeProductIds: string[] }
): Promise<Earned | null> {
  const lines = await listInvoiceLines(stripe, invoiceId);
  const revenue = earnedOrLog(
    invoiceId,
    referredInvoiceBase(figures, lines, subscriptionId, referred.stripeProductIds)
  );
  if (!revenue) return null;

  let earned = revenue;
  if (referred.stripeProductIds.length === 0) {
    const stored = await fillStripeProductIds(referred.id, revenue.productIds);
    if (stored.join() !== revenue.productIds.join()) {
      const again = earnedOrLog(invoiceId, referredInvoiceBase(figures, lines, subscriptionId, stored));
      // Never falls back to the figure computed against the stale, empty
      // product list: if the recompute against what is now stored cannot
      // earn, this invoice earns nothing, not the earlier guess.
      if (!again) return null;
      earned = again;
    }
  }
  if (earned.otherProductIds.length > 0) {
    console.warn(
      `[worker] invoice ${invoiceId} bills ${earned.otherProductIds.join(", ")} on subscription ${subscriptionId}, which its referral did not buy, so those lines earned nothing`
    );
  }
  return earned;
}

/**
 * The referred share as the ledger can store it.
 *
 * Commission.referredChargeMinor is a BIGINT column (migration
 * 20260914180000_commission_referred_charge_minor_bigint). Stripe's own
 * documented ceiling sits comfortably inside it: "the amount value supports
 * up to: 12 digits for most card payments, for a maximum of 999,999,999,999
 * in the smallest currency unit" and, for methods other than cards, "12
 * digits for IDR, for a payment of up to 9,999,999,999.99 IDR (999999999999)"
 * (Stripe docs, currencies.md, "Maximum payment amounts"; German original:
 * "12 Ziffern für die meisten Kartenzahlungen, für ein Maximum von
 * 999.999.999.999 in der kleinsten Währungseinheit" and "12 Ziffern für IDR,
 * für eine Zahlung in Höhe von maximal 9.999.999.999,99 IDR
 * (`999999999999`)"). 999,999,999,999 is past INTEGER's range, which is why
 * this column had to widen to BIGINT, and still far below
 * Number.MAX_SAFE_INTEGER (9,007,199,254,740,991), which is why converting it
 * to and from a plain number is always exact. A share outside that safe
 * range cannot come from a real Stripe amount, so it can only be a bug; a
 * retry would see the same bug again, but throwing still stops this event
 * from silently truncating the figure or quietly earning nothing, and gets
 * the failure into the logs where a bug can be found.
 */
export function storableReferredShare(shareMinor: number): bigint {
  if (!Number.isSafeInteger(shareMinor)) {
    throw new Error(
      `a referred share of ${shareMinor} is outside the range Supaffi can safely record, so this event is retried`
    );
  }
  return BigInt(shareMinor);
}

/**
 * A stored referred share read back as a plain number, for the maths in
 * chargeRefunded.ts, which predates BigInt and works in ordinary numbers
 * throughout. Every value this module ever wrote came through
 * storableReferredShare above, so it is always inside the safe range; this
 * only guards against something else having written the column directly.
 */
export function readStoredReferredShare(value: bigint | null): number | null {
  if (value === null) return null;
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`stored referred share ${value} is outside the range Supaffi can safely read, so this event is retried`);
  }
  return Number(value);
}
