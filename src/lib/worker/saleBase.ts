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

/**
 * A one-time purchase's base, from a Checkout Session read back with
 * `total_details.breakdown` expanded. A webhook payload never carries the
 * breakdown, since Stripe sends expandable fields only when asked for them.
 *
 * Stripe describes `amount_tax` only as "the sum of all the tax amounts" and
 * never says outright that tax inside an inclusive price is part of it. The
 * breakdown lists each rate's tax, inclusive or not, and Stripe says it adds
 * up to the totals. The larger of the two comes off, so if either figure
 * leaves inclusive tax out, the other still removes it. With no breakdown
 * there is no way to rule out tax left inside `amount_total`, so nothing is
 * earned. `amount_subtotal` is never used: tax inside an inclusive price is
 * part of a subtotal, and it is before discounts.
 *
 * Shipping comes off through the whole `shipping_cost.amount_total`, "Total
 * shipping cost after discounts and taxes are applied" (Stripe docs, Checkout
 * Session object), rather than that total less `shipping_cost.amount_tax`,
 * "Total tax amount applied due to shipping costs" (same page). Whether
 * shipping's own tax is already folded into `amount_tax` or the breakdown
 * above is undocumented, so it may already be part of the tax figure this
 * function just took off. Taking off the full shipping cost removes shipping
 * tax even when Stripe counts it nowhere else, at the cost of a possible
 * small affiliate underpay on a sale where it was already counted once,
 * rather than ever risk leaving shipping tax inside the base.
 */
export function checkoutSessionBaseMinor(
  session: Pick<Stripe.Checkout.Session, "amount_total" | "total_details" | "shipping_cost">
): number | null {
  if (session.amount_total == null || !session.total_details) return null;
  const taxes = session.total_details.breakdown?.taxes;
  if (!Array.isArray(taxes)) return null;
  const tax = Math.max(session.total_details.amount_tax, sumAmounts(taxes));
  const shipping = session.shipping_cost?.amount_total ?? 0;
  return Math.max(0, session.amount_total - tax - shipping);
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

/**
 * What an invoice's lines add up to before tax: the total before tax, less
 * shipping, which is not a line. Not clamped at zero, so the lines can be
 * checked against it. Null when the invoice does not say how much tax it
 * carried.
 */
export function invoiceLinesBeforeTax(
  invoice: Pick<Stripe.Invoice, "total" | "total_excluding_tax" | "total_taxes" | "shipping_cost">
): number | null {
  const beforeTax = invoiceTotalBeforeTax(invoice);
  if (beforeTax === null) return null;
  return beforeTax - shippingBeforeTax(invoice.shipping_cost);
}

/**
 * A base scaled to the part of the invoice paid in money. Credit balance or a
 * partial payment covered the rest, and only money that was actually paid
 * earns commission, in the same pre-tax proportion.
 */
export function scaleToAmountPaid(baseMinor: number, invoice: Pick<Stripe.Invoice, "total" | "amount_paid">): number {
  // A fully discounted invoice has nothing to earn on, and nothing to divide by.
  if (invoice.total <= 0) return 0;
  if (invoice.amount_paid >= invoice.total) return baseMinor;

  // Decimal because a large VND base times a large amount_paid passes what a
  // float holds exactly.
  return new Prisma.Decimal(baseMinor)
    .mul(invoice.amount_paid)
    .div(invoice.total)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function invoiceBaseMinor(
  invoice: Pick<Stripe.Invoice, "total" | "total_excluding_tax" | "total_taxes" | "amount_paid" | "shipping_cost">
): number | null {
  const linesBeforeTax = invoiceLinesBeforeTax(invoice);
  if (linesBeforeTax === null) return null;
  return scaleToAmountPaid(Math.max(0, linesBeforeTax), invoice);
}
