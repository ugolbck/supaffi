import type Stripe from "stripe";
import type { Affiliate } from "@prisma/client";

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

// Cheap vector, always on: both checkout.session.completed and invoice.paid
// carry the buyer's email inline in the payload already, no extra API call.
export function checkSelfReferralEmail(affiliate: Affiliate, buyerEmail: string | null): string | null {
  if (buyerEmail && normalize(buyerEmail) === normalize(affiliate.email)) {
    return "buyer email matches affiliate email";
  }
  return null;
}

// Resolves the buyer's card fingerprint for a just-completed Checkout
// Session. One-time ("payment" mode) sessions carry payment_intent
// directly; subscription-mode sessions require walking through the
// subscription's latest invoice to find the payment. Best-effort: any
// failure here just means the fingerprint check gets skipped, it never
// blocks or fails Commission creation.
export async function resolveBuyerFingerprint(
  stripe: Stripe,
  session: Stripe.Checkout.Session
): Promise<string | null> {
  try {
    if (session.mode === "payment" && session.payment_intent) {
      const piId =
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
      const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["payment_method"] });
      const pm = pi.payment_method;
      return typeof pm === "string" || !pm ? null : (pm.card?.fingerprint ?? null);
    }
    if (session.mode === "subscription" && session.subscription) {
      const subId =
        typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      const sub = await stripe.subscriptions.retrieve(subId, { expand: ["latest_invoice"] });
      const invoice = sub.latest_invoice;
      const invoiceId = typeof invoice === "string" ? invoice : invoice?.id;
      if (!invoiceId) return null;
      const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 1 });
      const paymentIntent = payments.data[0]?.payment.payment_intent;
      const piId = typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id;
      if (!piId) return null;
      const fullPi = await stripe.paymentIntents.retrieve(piId, { expand: ["payment_method"] });
      const pm = fullPi.payment_method;
      return typeof pm === "string" || !pm ? null : (pm.card?.fingerprint ?? null);
    }
  } catch (err) {
    console.error("[worker] failed to resolve buyer fingerprint", err);
  }
  return null;
}

// Only runs once, on the first purchase (checkout.session.completed), never
// re-run on renewals — the payment method was already checked when it
// first appeared. A real, accepted gap: stripe.customers.list({ email })
// is an exact-match filter, this won't catch a differently-cased or
// entirely different email used as the affiliate's own Stripe customer.
export async function checkPaymentMethodOverlap(
  stripe: Stripe,
  affiliate: Affiliate,
  buyerFingerprint: string | null,
  buyerCustomerId: string | null
): Promise<string | null> {
  if (!buyerFingerprint) return null;
  try {
    const candidates = await stripe.customers.list({ email: affiliate.email, limit: 3 });
    for (const candidate of candidates.data) {
      if (candidate.id === buyerCustomerId) continue;
      const methods = await stripe.paymentMethods.list({ customer: candidate.id, type: "card" });
      if (methods.data.some((m) => m.card?.fingerprint === buyerFingerprint)) {
        return "payment method matches a Stripe Customer sharing the affiliate's email";
      }
    }
  } catch (err) {
    console.error(`[worker] payment-method overlap check failed for affiliate ${affiliate.id}`, err);
  }
  return null;
}
