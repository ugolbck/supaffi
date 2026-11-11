import Stripe from "stripe";
import { decrypt } from "@/lib/crypto";
import { stripeApiLocation } from "@/lib/payments/stripe/apiLocation";

// Pinned explicitly so outgoing calls made *by* Supaffi always get object
// shapes matching the bundled SDK's types, regardless of what API version
// a Merchant's Stripe account happens to default to. This does NOT control
// the shape of *incoming* webhook payloads — those reflect whichever API
// version was active on the Merchant's webhook endpoint when they created
// it in the Stripe Dashboard, which Supaffi has no control over. Handlers
// that read fields sensitive to this (e.g. Charge.invoice, removed in this
// version) defensively check for older shapes too.
const STRIPE_API_VERSION = "2026-09-30.endive" as const;

// Stripe is connected in its own onboarding step, so a Merchant can exist
// without a key. Nothing queues Stripe work for such a Merchant (no webhook
// secret means the webhook route rejects the delivery before it is ever
// stored), so reaching here without a key is a bug, not a user state.
export function stripeClientFor(merchant: { paymentKeyEnc: string | null }): Stripe {
  if (!merchant.paymentKeyEnc) {
    throw new Error("Stripe is not connected for this Merchant");
  }
  return new Stripe(decrypt(merchant.paymentKeyEnc), {
    apiVersion: STRIPE_API_VERSION,
    ...stripeApiLocation(),
  });
}
