import type { Affiliate, Program } from "@prisma/client";
import type Stripe from "stripe";
import { minorUnitsToMajor } from "@/lib/stripe";

export function commissionRateFor(affiliate: Affiliate, program: Program): number {
  return Number(affiliate.customCommissionRate ?? program.defaultCommissionRate);
}

export function computeCommissionAmount(
  paidAmountMinor: number,
  currency: string,
  ratePercent: number
): number {
  const paid = minorUnitsToMajor(paidAmountMinor, currency);
  return Math.round(paid * (ratePercent / 100) * 100) / 100;
}

export function computePayableAt(program: Program, from: Date = new Date()): Date {
  return new Date(from.getTime() + program.holdingPeriodDays * 24 * 60 * 60 * 1000);
}

export function isWithinCommissionDuration(
  program: Program,
  clickCreatedAt: Date,
  chargedAt: Date
): boolean {
  switch (program.commissionDurationType) {
    case "FOREVER":
      return true;
    case "ONE_TIME":
      // The one and only Commission for a ONE_TIME program is created by
      // checkout completion; no renewal invoice should ever count.
      return false;
    case "FIXED_MONTHS": {
      const cutoff = new Date(clickCreatedAt);
      cutoff.setMonth(cutoff.getMonth() + (program.commissionDurationMonths ?? 0));
      return chargedAt < cutoff;
    }
  }
}

function readMetadataFlag(metadata: Stripe.Metadata | null | undefined): boolean {
  return metadata?.supaffi === "false";
}

// Checks the exclusion metadata flag (CONTEXT.md) on Invoice and
// Subscription, plus one Customer retrieve. Charge-level metadata is
// deliberately not checked — reaching it costs an extra API hop the other
// three vectors don't need, and Charges are usually system-generated for
// subscriptions rather than something a Merchant's own integration code
// touches directly. A documented scope narrowing, not an oversight.
export async function isExcluded(
  stripe: Stripe,
  opts: {
    invoiceMetadata?: Stripe.Metadata | null;
    subscriptionMetadata?: Stripe.Metadata | null;
    customerId: string | null;
  }
): Promise<boolean> {
  if (readMetadataFlag(opts.invoiceMetadata)) return true;
  if (readMetadataFlag(opts.subscriptionMetadata)) return true;
  if (!opts.customerId) return false;

  try {
    const customer = await stripe.customers.retrieve(opts.customerId);
    if ("deleted" in customer && customer.deleted) return false;
    return readMetadataFlag((customer as Stripe.Customer).metadata);
  } catch (err) {
    console.error(`[worker] failed to check exclusion metadata for customer ${opts.customerId}`, err);
    // Fail open: losing a real Commission during a transient Stripe outage
    // is worse than rarely not honoring an opt-in exclusion flag during one.
    return false;
  }
}
