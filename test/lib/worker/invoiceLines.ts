// Invoice lines shaped the way invoices.listLineItems returns them on the
// pinned API version (2026-09-30.endive). Only the fields referredRevenue.ts
// reads are filled in. No database import, so unit suites can use it.
import type Stripe from "stripe";

export const PRODUCT_ID = "prod_basic";
export const LINE_SUBSCRIPTION_ID = "sub_renewal";

export type LineOptions = {
  id?: string;
  /** The line's `amount`, in minor units. */
  amount: number;
  /** Null leaves `pricing` off the line. */
  product?: string | null;
  /** Defaults to LINE_SUBSCRIPTION_ID on subscription item lines, and to none on invoice item lines. */
  subscription?: string | null;
  /** Where the line came from: a subscription item, an invoice item, no parent, or a parent type this code does not know. */
  source?: "subscription_item" | "invoice_item" | "none" | "unknown";
  proration?: boolean;
  inclusiveTax?: number;
  exclusiveTax?: number;
  /** A discount on the line, listed in discount_amounts and, unless creditsIn says otherwise, in pretax_credit_amounts. */
  discount?: number;
  creditsIn?: "both" | "discount_amounts_only";
};

let lineCount = 0;

function tax(amount: number, behavior: "inclusive" | "exclusive") {
  return {
    amount,
    tax_behavior: behavior,
    taxability_reason: "standard_rated",
    taxable_amount: null,
    tax_rate_details: { tax_rate: "txr_1" },
    type: "tax_rate_details",
  };
}

export function invoiceLine(opts: LineOptions): Stripe.InvoiceLineItem {
  const source = opts.source ?? "subscription_item";
  const proration = opts.proration ?? false;
  const subscription =
    opts.subscription !== undefined ? opts.subscription : source === "subscription_item" ? LINE_SUBSCRIPTION_ID : null;

  let parent: unknown;
  if (source === "none") parent = null;
  else if (source === "unknown") parent = { type: "license_fee_subscription_details" };
  else if (source === "subscription_item") {
    parent = {
      type: "subscription_item_details",
      invoice_item_details: null,
      subscription_item_details: {
        subscription,
        subscription_item: "si_basic",
        proration,
        proration_details: null,
        invoice_item: proration ? "ii_proration" : null,
      },
    };
  } else {
    parent = {
      type: "invoice_item_details",
      subscription_item_details: null,
      invoice_item_details: { invoice_item: "ii_one_off", subscription, proration, proration_details: null },
    };
  }

  const discount = opts.discount ?? 0;
  const discountEntry = { amount: discount, discount: "di_1" };
  return {
    id: opts.id ?? `il_${++lineCount}`,
    object: "line_item",
    amount: opts.amount,
    subtotal: opts.amount,
    currency: "eur",
    discount_amounts: discount ? [discountEntry] : [],
    pretax_credit_amounts:
      opts.creditsIn === "discount_amounts_only" ? null : discount ? [{ ...discountEntry, type: "discount" }] : [],
    parent,
    pricing:
      opts.product === null
        ? null
        : {
            type: "price_details",
            unit_amount_decimal: null,
            price_details: { price: "price_basic", product: opts.product ?? PRODUCT_ID },
          },
    taxes: [
      ...(opts.inclusiveTax ? [tax(opts.inclusiveTax, "inclusive")] : []),
      ...(opts.exclusiveTax ? [tax(opts.exclusiveTax, "exclusive")] : []),
    ],
  } as unknown as Stripe.InvoiceLineItem;
}
