import { REQUIRED_STRIPE_WEBHOOK_EVENTS } from "@/lib/stripeWebhookEvents";

/**
 * The pre-filled webhook link, the sibling of stripeRestrictedKey.ts.
 *
 * Same caveat: Stripe's Dashboard accepts `/webhooks/create` with
 * `endpoint_location` and repeated `events[]`, and none of it is documented.
 * Verify by opening the link before trusting a change here. If Stripe stops
 * honouring it, the onboarding screen falls back to showing the endpoint and
 * the events to copy, which it does anyway underneath the button.
 *
 * The event list itself is not duplicated here: it is
 * `REQUIRED_STRIPE_WEBHOOK_EVENTS`, the same list `src/lib/worker/dispatch.ts`
 * handles.
 */
export const WEBHOOK_EVENTS = REQUIRED_STRIPE_WEBHOOK_EVENTS;

export function webhookEndpointUrl(domain: string): string {
  return `https://${domain}/api/webhooks/stripe`;
}

export function webhookCreateUrl(domain: string): string {
  const params = new URLSearchParams();
  params.set("endpoint_location", webhookEndpointUrl(domain));
  const events = WEBHOOK_EVENTS.map((e) => `events[]=${encodeURIComponent(e)}`).join("&");
  return `https://dashboard.stripe.com/webhooks/create?${params.toString()}&${events}`;
}
