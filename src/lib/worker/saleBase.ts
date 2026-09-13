import { Prisma } from "@prisma/client";
import type Stripe from "stripe";

/**
 * The part of a sale a commission is earned on, in Stripe minor units.
 *
 * Tax is a liability the business passes on to a tax authority, not revenue,
 * so it never earns commission. That holds whether prices add tax at checkout
 * or already include it: a 120 EUR price with 20 EUR VAT inside it is 100 EUR
 * of revenue. Shipping is a pass-through cost too. Discounts do lower the
 * base, since the customer never paid them. Stripe's processing fees do not:
 * they differ by payment method and an affiliate has no way to check them.
 *
 * A null return means the payload did not say how much tax it carried. The
 * caller records nothing rather than guess, because every fallback that is
 * still available at that point is a total with the tax inside it.
 */

type ShippingCost = { amount_total: number; amount_tax: number } | null | undefined;

// Total minus tax rather than amount_subtotal: with a tax-inclusive shipping
// rate the subtotal can still hold the tax, while this difference is shipping
// before tax either way. The tax on shipping is already inside the tax figure
// each caller removes, so it is not taken off twice.
function shippingBeforeTax(shipping: ShippingCost): number {
  if (!shipping) return 0;
  return Math.max(0, shipping.amount_total - shipping.amount_tax);
}

export function checkoutSessionBaseMinor(
  session: Pick<Stripe.Checkout.Session, "amount_total" | "total_details" | "shipping_cost">
): number | null {
  if (session.amount_total == null || !session.total_details) return null;
  // amount_tax sums inclusive and exclusive tax alike. amount_subtotal is not
  // used: it is before discounts.
  const base = session.amount_total - session.total_details.amount_tax - shippingBeforeTax(session.shipping_cost);
  return Math.max(0, base);
}

// API versions before 2025-03-31 sent `total_tax_amounts` in place of
// `total_taxes`. Supaffi creates its webhook endpoint without pinning a
// version, so an older Stripe account still delivers that shape even though
// the pinned SDK types no longer declare it.
type LegacyInvoiceTax = { total_tax_amounts?: Array<{ amount: number }> | null };

function sumAmounts(lines: Array<{ amount: number }>): number {
  return lines.reduce((total, line) => total + line.amount, 0);
}

function invoiceTotalBeforeTax(
  invoice: Pick<Stripe.Invoice, "total" | "total_excluding_tax" | "total_taxes">
): number | null {
  if (invoice.total_excluding_tax != null) return invoice.total_excluding_tax;
  if (Array.isArray(invoice.total_taxes)) return invoice.total - sumAmounts(invoice.total_taxes);
  const legacy = (invoice as unknown as LegacyInvoiceTax).total_tax_amounts;
  if (Array.isArray(legacy)) return invoice.total - sumAmounts(legacy);
  return null;
}

export function invoiceBaseMinor(
  invoice: Pick<Stripe.Invoice, "total" | "total_excluding_tax" | "total_taxes" | "amount_paid" | "shipping_cost">
): number | null {
  const beforeTax = invoiceTotalBeforeTax(invoice);
  if (beforeTax === null) return null;
  const base = Math.max(0, beforeTax - shippingBeforeTax(invoice.shipping_cost));

  // A fully discounted invoice has nothing to earn on, and nothing to divide by.
  if (invoice.total <= 0) return 0;
  if (invoice.amount_paid >= invoice.total) return base;

  // Credit balance or a partial payment covered the rest. Only money that was
  // actually paid earns commission, in the same pre-tax proportion. Decimal
  // because a large VND base times a large amount_paid passes what a float
  // holds exactly.
  return new Prisma.Decimal(base)
    .mul(invoice.amount_paid)
    .div(invoice.total)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}
