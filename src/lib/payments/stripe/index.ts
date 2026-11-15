import Stripe from "stripe";
import type { PaymentProviderAdapter } from "@/lib/payments/types";
import { stripeKeyWorks } from "@/lib/payments/stripe/keyCheck";
import { stripePromoCodes } from "@/lib/payments/stripe/promoCodes";
import { processStripeEvent } from "@/lib/payments/stripe/dispatch";
import { isStripeError, stripeErrorLabel } from "@/lib/payments/stripe/errors";
import { REQUIRED_STRIPE_WEBHOOK_EVENTS } from "@/lib/payments/stripe/webhookEvents";
import { moveMerchantWebhookEndpoint, upgradeAllWebhookEvents } from "@/lib/payments/stripe/endpointUpkeep";

export const stripeProvider: PaymentProviderAdapter = {
  id: "STRIPE",
  name: "Stripe",
  webhookSlug: "stripe",
  signatureHeader: "stripe-signature",
  checkKey: (key) => stripeKeyWorks(key),

  verifyWebhook({ rawBody, headers, secret }) {
    const signature = headers.get("stripe-signature");
    if (!signature) return null;
    try {
      const event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
      return { eventId: event.id, payload: event };
    } catch {
      return null;
    }
  },

  processEvent: processStripeEvent,
  handledEvents: REQUIRED_STRIPE_WEBHOOK_EVENTS,

  errorLabel(err) {
    return isStripeError(err) ? `Stripe error ${stripeErrorLabel(err)}` : null;
  },

  // A payment or an invoice id is worth following into the dashboard the
  // owner already has open. Anything else is shown as it came, rather than
  // guessed into a URL that would 404.
  paymentUrl(ref) {
    if (ref.startsWith("pi_")) return `https://dashboard.stripe.com/payments/${ref}`;
    if (ref.startsWith("in_")) return `https://dashboard.stripe.com/invoices/${ref}`;
    return null;
  },

  upgradeWebhookEndpoints: () => upgradeAllWebhookEvents(),
  moveWebhookEndpoint: (merchantId) => moveMerchantWebhookEndpoint(merchantId),
  promoCodes: stripePromoCodes,
};
