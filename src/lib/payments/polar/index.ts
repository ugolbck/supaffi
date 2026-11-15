import type { PaymentProviderAdapter } from "@/lib/payments/types";
import { polarTokenWorks } from "@/lib/payments/polar/connect";
import { polarPromoCodes } from "@/lib/payments/polar/promoCodes";
import { processPolarEvent } from "@/lib/payments/polar/dispatch";
import { isPolarApiError } from "@/lib/payments/polar/api";
import { verifyPolarSignature } from "@/lib/payments/polar/signature";
import { POLAR_WEBHOOK_EVENTS } from "@/lib/payments/polar/webhookEvents";
import { movePolarEndpoint, upgradePolarEndpoints } from "@/lib/payments/polar/upkeep";

export const polarProvider: PaymentProviderAdapter = {
  id: "POLAR",
  name: "Polar",
  webhookSlug: "polar",
  signatureHeader: "webhook-signature",
  checkKey: (key) => polarTokenWorks(key),

  verifyWebhook({ rawBody, headers, secret }) {
    if (!verifyPolarSignature(rawBody, headers, secret)) return null;
    // webhook-id is the event's own id, the same on every retry and manual
    // redelivery (polar.sh/docs/integrate/webhooks/delivery), so it dedupes.
    const eventId = headers.get("webhook-id");
    if (!eventId) return null;
    return { eventId, payload: JSON.parse(rawBody) };
  },

  processEvent: processPolarEvent,
  handledEvents: POLAR_WEBHOOK_EVENTS,

  errorLabel(err) {
    return isPolarApiError(err) ? err.message : null;
  },

  // An order's page in the Polar dashboard needs the organization's slug,
  // which Supaffi does not keep, so the id is shown as it is.
  paymentUrl: () => null,

  upgradeWebhookEndpoints: upgradePolarEndpoints,
  moveWebhookEndpoint: movePolarEndpoint,
  promoCodes: polarPromoCodes,
};
