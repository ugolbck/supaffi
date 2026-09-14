import type Stripe from "stripe";
import { invoiceLinesBeforeTax, scaleToAmountPaid } from "./saleBase";

/**
 * The part of a renewal invoice that is referred revenue, in Stripe minor units.
 *
 * A referral bought a subscription to certain Stripe products. Other things
 * land on that subscription's invoices too: a one-off item the merchant added
 * to the customer or to the subscription, and the price of another product the
 * subscription was moved to, which on a shared Stripe account is usually
 * another Supaffi product's revenue. Only the subscription's own lines for the
 * referred products earn, with the prorations Stripe generates when the plan
 * changes inside those products.
 *
 * A subscription item line's `subscription` field can be null. Stripe's API
 * reference does not say when that happens, so this module never assumes a
 * null id belongs to the referred subscription. It is read as referred only
 * when its `subscription_item` id is in the list the caller optionally
 * supplies of the referred subscription's own item ids; otherwise it simply
 * earns nothing, the same as an unrelated one-off item, rather than failing
 * the whole invoice. A line naming a different, non-null subscription is
 * never referred either.
 *
 * An invoice item line (a proration Stripe bills outside a subscription item,
 * as when a plan change happens between renewals) is referred only when it is
 * a proration and its `subscription` names the referred subscription exactly.
 * Stripe's own documentation for creating an invoice item says a blank
 * subscription lets the item ride on any subscription's invoice, so a null
 * subscription here proves nothing and is read as not referred.
 *
 * The lines are read with Supaffi's pinned API version, never taken from the
 * webhook payload. The payload follows the version of the Merchant's endpoint,
 * which Supaffi does not choose; before 2025-03-31.basil its lines had neither
 * `parent` nor `pricing`, and it only ever carries the first page of lines.
 *
 * When a line cannot be placed, or the lines do not add up to the invoice,
 * nothing earns. Underpaying an affiliate is the accepted cost of never paying
 * on revenue nobody referred.
 */

export type ReferredRevenue =
  | {
      kind: "earned";
      /** The referred lines before tax, scaled to what was paid in money. */
      baseMinor: number;
      /** The products the base was earned on, learned from this invoice when none were stored. */
      productIds: string[];
      /** Products on this subscription's lines that its referral did not buy. */
      otherProductIds: string[];
    }
  | { kind: "no_tax_breakdown" }
  | { kind: "unreadable"; reason: string };

// Stripe caps a list page at 100.
const LINES_PAGE_SIZE = 100;

/**
 * Every line of an invoice, page by page. A failed read throws, so the event
 * is retried rather than a renewal judged on part of its lines.
 */
export async function listInvoiceLines(stripe: Stripe, invoiceId: string): Promise<Stripe.InvoiceLineItem[]> {
  const lines: Stripe.InvoiceLineItem[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.invoices.listLineItems(
      invoiceId,
      startingAfter ? { limit: LINES_PAGE_SIZE, starting_after: startingAfter } : { limit: LINES_PAGE_SIZE }
    );
    lines.push(...page.data);
    // An empty page that still claims more would be asked for forever.
    // Stopping leaves the list short, and a short list never adds up to the
    // invoice, so that invoice earns nothing.
    if (!page.has_more || page.data.length === 0) return lines;
    startingAfter = page.data[page.data.length - 1].id;
  }
}

type PlacedLine =
  | { kind: "subscription"; product: string; proration: boolean }
  | { kind: "not_referred" }
  | { kind: "unreadable"; reason: string };

function productOf(line: Stripe.InvoiceLineItem): string | null {
  const product = line.pricing?.price_details?.product;
  return typeof product === "string" && product.length > 0 ? product : null;
}

function placeLine(
  line: Stripe.InvoiceLineItem,
  subscriptionId: string,
  subscriptionItemIds: string[] | undefined
): PlacedLine {
  const parent = line.parent;
  if (parent?.type === "subscription_item_details" && parent.subscription_item_details) {
    const details = parent.subscription_item_details;
    // A line naming this invoice's subscription is referred. One naming a
    // different, non-null subscription never is. A null subscription proves
    // nothing on its own, so it is referred only when the caller supplied the
    // referred subscription's own item ids and this line's item is one of
    // them.
    const referred =
      details.subscription === subscriptionId ||
      (details.subscription === null && (subscriptionItemIds ?? []).includes(details.subscription_item));
    if (!referred) return { kind: "not_referred" };
    const product = productOf(line);
    if (!product) return { kind: "unreadable", reason: `has a subscription line ${line.id} without a product` };
    return { kind: "subscription", product, proration: details.proration };
  }
  if (parent?.type === "invoice_item_details" && parent.invoice_item_details) {
    const details = parent.invoice_item_details;
    // Only Stripe marks an invoice item as a proration, when this
    // subscription's plan changes; creating an invoice item offers no such
    // option. Every other invoice item is a one-off the merchant added, to the
    // customer or to the subscription, and nobody referred it. A blank
    // subscription lets an invoice item ride on any subscription's invoice, so
    // only an exact match on this subscription's id is referred; a null one is
    // not.
    if (!details.proration || details.subscription !== subscriptionId) return { kind: "not_referred" };
    const product = productOf(line);
    if (!product) return { kind: "unreadable", reason: `has a proration line ${line.id} without a product` };
    return { kind: "subscription", product, proration: true };
  }
  return { kind: "unreadable", reason: `has a line ${line.id} whose origin Supaffi cannot read` };
}

function sumAmounts(entries: Array<{ amount: number }> | null | undefined): number {
  return (entries ?? []).reduce((total, entry) => total + entry.amount, 0);
}

// Tax inside a tax-inclusive price is part of the line's amount. Tax added on
// top of an exclusive price never was, so only the inclusive part comes off.
function inclusiveTax(line: Stripe.InvoiceLineItem): number {
  return sumAmounts((line.taxes ?? []).filter((tax) => tax.tax_behavior === "inclusive"));
}

// pretax_credit_amounts lists discounts and credit grants together and repeats
// what discount_amounts holds, so it is used on its own whenever it is present.
function credits(line: Stripe.InvoiceLineItem): number {
  return line.pretax_credit_amounts != null ? sumAmounts(line.pretax_credit_amounts) : sumAmounts(line.discount_amounts);
}

/**
 * Each line's base before tax and after discounts, in the reading of `amount`
 * that adds up to the invoice's own total before tax. Stripe does not say
 * whether a line's amount already has its discounts taken off, so both
 * readings are checked against the figure Stripe computed and the one that
 * matches is used. Without discounts they are the same; with discounts at most
 * one can match. Null when neither does, meaning lines are missing or shaped
 * in a way this code does not know.
 */
function lineBases(lines: Stripe.InvoiceLineItem[], invoiceBeforeTax: number): number[] | null {
  const readings = [
    lines.map((line) => line.amount - inclusiveTax(line) - credits(line)),
    lines.map((line) => line.amount - inclusiveTax(line)),
  ];
  return readings.find((bases) => bases.reduce((total, base) => total + base, 0) === invoiceBeforeTax) ?? null;
}

const uniqueSorted = (values: string[]) => [...new Set(values)].sort();

export function referredInvoiceBase(
  invoice: Pick<Stripe.Invoice, "total" | "total_excluding_tax" | "total_taxes" | "amount_paid" | "shipping_cost">,
  lines: Stripe.InvoiceLineItem[],
  subscriptionId: string,
  referredProductIds: string[],
  /**
   * The referred subscription's own subscription item ids, used to place a
   * subscription line whose `subscription` field came back null. Optional
   * because the caller may not have them; Task 4 decides whether to supply
   * this list.
   */
  subscriptionItemIds?: string[]
): ReferredRevenue {
  const invoiceBeforeTax = invoiceLinesBeforeTax(invoice);
  if (invoiceBeforeTax === null) return { kind: "no_tax_breakdown" };

  const placed: PlacedLine[] = [];
  for (const line of lines) {
    const place = placeLine(line, subscriptionId, subscriptionItemIds);
    if (place.kind === "unreadable") return place;
    placed.push(place);
  }

  const bases = lineBases(lines, invoiceBeforeTax);
  if (!bases) return { kind: "unreadable", reason: "has lines that do not add up to its total before tax" };

  const ownLines = placed.flatMap((place, index) =>
    place.kind === "subscription" ? [{ product: place.product, proration: place.proration, base: bases[index] }] : []
  );

  // A subscription recorded without its products takes them from the prices
  // this renewal bills. Prorations are left out: a plan change credits the
  // product being left. An empty stored list means the products are not known
  // yet, never that every product on the invoice is referred, so only this
  // subscription's own non-proration lines seed it.
  const productIds =
    referredProductIds.length > 0
      ? referredProductIds
      : uniqueSorted(ownLines.filter((line) => !line.proration).map((line) => line.product));
  if (productIds.length === 0) {
    return { kind: "unreadable", reason: `bills no price of subscription ${subscriptionId} to learn its products from` };
  }

  const referred = ownLines
    .filter((line) => productIds.includes(line.product))
    .reduce((total, line) => total + line.base, 0);
  const otherProductIds = uniqueSorted(
    ownLines.filter((line) => !productIds.includes(line.product)).map((line) => line.product)
  );

  // Never more than the whole invoice before tax: a credit the merchant added
  // lowers what the customer paid, and commission is owed on money paid.
  const base = Math.max(0, Math.min(referred, invoiceBeforeTax));
  return { kind: "earned", baseMinor: scaleToAmountPaid(base, invoice), productIds, otherProductIds };
}
