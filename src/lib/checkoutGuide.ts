import type { PaymentProvider } from "@prisma/client";
import { REFERRAL_COOKIE, REFERRAL_METADATA_KEY } from "@/lib/referral";

/**
 * What the owner's own checkout code needs, per payment provider: the call
 * that creates a checkout, with the referral cookie passed through in its
 * metadata, and the hosted checkouts the tracking script already covers.
 */
export type CheckoutGuide = {
  /** Wherever that call is made, server side. */
  where: string;
  /** The same, as the next step after the tracking script during onboarding. */
  then: string;
  /** The checkouts the provider builds without the owner's code, which need nothing. */
  hosted: string;
  snippet: string;
  /** The same two facts, for the assistant prompt. */
  prompt: { provider: string; hosted: string };
};

function snippet(call: string): string {
  return `const referralToken = cookies.get("${REFERRAL_COOKIE}");

await ${call}({
  // ...your existing options
  metadata: {
    // ...your existing metadata
    ...(referralToken && { ${REFERRAL_METADATA_KEY}: referralToken }),
  },
});`;
}

const GUIDES: Record<PaymentProvider, CheckoutGuide> = {
  STRIPE: {
    where: "Wherever you create the Stripe Checkout Session, server side.",
    then: "Then, wherever you create the Stripe checkout session.",
    hosted: "Stripe Payment Links, buy buttons and pricing tables need nothing more.",
    snippet: snippet("stripe.checkout.sessions.create"),
    prompt: { provider: "Stripe Checkout", hosted: "Stripe Payment Links, buy buttons or pricing tables" },
  },
  POLAR: {
    where: "Wherever you create the Polar checkout session, server side.",
    then: "Then, wherever you create the Polar checkout session.",
    hosted: "Polar checkout links need nothing more.",
    snippet: snippet("polar.checkouts.create"),
    prompt: { provider: "Polar checkout", hosted: "Polar checkout links" },
  },
};

export function checkoutGuideFor(provider: PaymentProvider): CheckoutGuide {
  return GUIDES[provider];
}
