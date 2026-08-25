import Stripe from "stripe";
import { decrypt } from "@/lib/crypto";

// Pinned explicitly so outgoing calls made *by* Supaffi always get object
// shapes matching the bundled SDK's types, regardless of what API version
// a Merchant's Stripe account happens to default to. This does NOT control
// the shape of *incoming* webhook payloads — those reflect whichever API
// version was active on the Merchant's webhook endpoint when they created
// it in the Stripe Dashboard, which Supaffi has no control over. Handlers
// that read fields sensitive to this (e.g. Charge.invoice, removed in this
// version) defensively check for older shapes too.
const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;

export function stripeClientFor(merchant: { stripeSecretKeyEnc: string }): Stripe {
  return new Stripe(decrypt(merchant.stripeSecretKeyEnc), {
    apiVersion: STRIPE_API_VERSION,
  });
}

// Stripe amounts are integers in the currency's smallest unit, except for a
// documented set of zero-decimal currencies (already whole units) and a
// few three-decimal currencies. Getting this wrong silently makes
// Commission.amount 100x too small or large for affected currencies.
const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg",
  "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);
const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

export function minorUnitsToMajor(amountMinor: number, currency: string): number {
  const cur = currency.toLowerCase();
  if (ZERO_DECIMAL.has(cur)) return amountMinor;
  if (THREE_DECIMAL.has(cur)) return amountMinor / 1000;
  return amountMinor / 100;
}
