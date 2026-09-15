import { Prisma } from "@prisma/client";
import type { Affiliate, Program } from "@prisma/client";
import type Stripe from "stripe";
import { minorUnitsToMajor } from "@/lib/stripe";

export function commissionRateFor(affiliate: Affiliate, program: Program): number {
  return Number(affiliate.customCommissionRate ?? program.defaultCommissionRate);
}

// Decimal rather than float arithmetic: an exact half cent is often held as
// a hair under it in binary floating point, so float rounding took it down
// where the ledger should round it up.
export function computeCommissionAmount(
  paidAmountMinor: number,
  currency: string,
  ratePercent: number
): Prisma.Decimal {
  return new Prisma.Decimal(minorUnitsToMajor(paidAmountMinor, currency))
    .mul(ratePercent)
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** The customer's payment in major units, for the revenue the commission was earned on. */
export function saleAmountFor(paidAmountMinor: number, currency: string): number {
  return minorUnitsToMajor(paidAmountMinor, currency);
}

export function computePayableAt(program: Program, from: Date = new Date()): Date {
  return new Date(from.getTime() + program.holdingPeriodDays * 24 * 60 * 60 * 1000);
}

/** A payment Supaffi can recognise again: its Stripe id and when it was charged. */
export type PaymentRef = { ref: string; at: Date };

/**
 * The same day and time a number of calendar months later, in UTC, stopping at
 * the last day of a shorter month. Date.setMonth rolls January 31 plus one
 * month over to March 3, which quietly stretched a fixed-months program.
 */
export function addMonthsClamped(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(from.getUTCDate(), lastDayOfTargetMonth),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds()
    )
  );
}

// A renewal lands on the anniversary of the first payment, give or take the
// minutes between a Checkout Session opening and Stripe creating the invoice.
// Without slack, the renewal that opens month N+1 could fall a moment inside
// the window and pay one month too many. A day is far shorter than any billing
// interval a fixed-months program is used with.
const DURATION_BOUNDARY_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a payment still earns, measured from the referral's first payment,
 * not from when the click happened. A click can come weeks before the
 * purchase, and a free trial delays the first payment further. Callers pass the
 * first payment of the whole referral (referralDuration.ts), so a second
 * subscription on the same click does not start the duration over.
 */
export function isPaymentWithinCommissionDuration(
  program: Program,
  firstPayment: PaymentRef,
  payment: PaymentRef
): boolean {
  if (payment.ref === firstPayment.ref) return true;
  switch (program.commissionDurationType) {
    case "FOREVER":
      return true;
    case "ONE_TIME":
      return false;
    case "FIXED_MONTHS": {
      const end = addMonthsClamped(firstPayment.at, program.commissionDurationMonths ?? 0);
      return payment.at.getTime() < end.getTime() - DURATION_BOUNDARY_GRACE_MS;
    }
  }
}

/** Whether a metadata map carries the exclusion flag (CONTEXT.md). */
export function hasExclusionFlag(metadata: Stripe.Metadata | null | undefined): boolean {
  return metadata?.supaffi === "false";
}

type Flaggable = { id: string; metadata?: Stripe.Metadata | null };

/**
 * Where a sale's exclusion flag can sit. Each is an object the handler already
 * holds, which costs nothing to check, or an id, which is read from Stripe.
 * Null or absent means the sale has none of that kind.
 */
export type ExclusionSources = {
  invoice?: string | Flaggable | null;
  subscription?: string | Flaggable | null;
  customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null;
};

// A failed read is never taken as "not excluded". Earning on a sale the
// merchant excluded is the loss this check exists to prevent, so the event
// fails instead and the worker retries it; an outage delays the commission
// rather than letting it through unchecked.
// `named` is what the thrown message may print for this read: the invoice or
// subscription's own id for those two, but never a customer id, so the caller
// passes the sale's own reference instead when reading the customer.
async function readForExclusion<T>(what: string, named: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    // Only the error's type and code go into the thrown message, never
    // Stripe's own message and never the original error as `cause`: tick.ts
    // logs the whole thrown error, and Node's default inspection of an Error
    // prints its `cause` too, so keeping it there would still put Stripe's
    // raw message (which, on a permission or authentication failure, names
    // the masked key and the account) into the server log, the same pattern
    // retrieveSessionForEarning uses in checkoutSessionCompleted.ts.
    const { type, code } = err as { type?: string; code?: string };
    throw new Error(
      `could not read ${what} ${named} (${type ?? "unknown"}/${code ?? "unknown"}) to check whether its sale is excluded, so no commission was recorded and the event will be retried`
    );
  }
}

function customerIsExcluded(customer: Stripe.Customer | Stripe.DeletedCustomer, saleRef: string): boolean {
  // A deleted customer comes back with no metadata left to carry the flag:
  // "If it's for a deleted Customer, a subset of the customer's information
  // is returned, including a deleted property that's set to true" (Stripe
  // docs, Retrieve a customer). When Supaffi cannot tell whether the flag was
  // set, it earns nothing, so a deleted customer counts as excluded. The sale
  // is named by its own Stripe reference, never by anything about the
  // customer, since the customer is the very thing that could not be read.
  if ("deleted" in customer && customer.deleted) {
    console.warn(`[worker] sale ${saleRef}'s customer was deleted, so it was treated as excluded and earned nothing`);
    return true;
  }
  return hasExclusionFlag((customer as Stripe.Customer).metadata);
}

// Checks the exclusion flag on the invoice, the subscription and the customer,
// in that order, and stops at the first one set. Charge-level metadata is
// deliberately not checked: reaching it costs an extra API hop the other three
// do not need, and charges are usually made by Stripe for subscriptions rather
// than touched by a merchant's own code. A documented scope narrowing, not an
// oversight.
//
// Nothing here trusts a webhook payload for the subscription's flag. Where an
// invoice event carries its subscription's metadata depends on the API version
// of the merchant's account, it is only a snapshot taken when the invoice was
// finalized, and a Checkout Session carries none at all. Callers pass objects
// Supaffi read back through its own pinned client, or ids to read here.
//
// saleRef names the sale itself (an invoice id, or a Checkout Session's
// PaymentIntent reference) for the one log line a deleted customer produces,
// so the line can be traced back to a sale without ever printing anything
// about the customer.
export async function isExcluded(stripe: Stripe, sources: ExclusionSources, saleRef: string): Promise<boolean> {
  const { invoice, subscription, customer } = sources;

  if (invoice) {
    const read =
      typeof invoice === "string"
        ? await readForExclusion("invoice", invoice, () => stripe.invoices.retrieve(invoice))
        : invoice;
    if (hasExclusionFlag(read.metadata)) return true;
  }

  if (subscription) {
    const read =
      typeof subscription === "string"
        ? await readForExclusion("subscription", subscription, () => stripe.subscriptions.retrieve(subscription))
        : subscription;
    if (hasExclusionFlag(read.metadata)) return true;
  }

  if (customer) {
    const read =
      typeof customer === "string"
        ? // Named by the sale, never by the customer id: the id being read is
          // the very thing a failed read must not print.
          await readForExclusion("customer", saleRef, () => stripe.customers.retrieve(customer))
        : customer;
    if (customerIsExcluded(read, saleRef)) return true;
  }

  return false;
}
