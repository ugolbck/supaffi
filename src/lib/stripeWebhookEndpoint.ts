import Stripe from "stripe";
import { REQUIRED_STRIPE_WEBHOOK_EVENTS } from "@/lib/stripeWebhookEvents";

export type EndpointResult =
  | { ok: true; id: string; secret: string }
  | { ok: false; reason: "permission" | "unreachable" | "error"; detail: string };

/**
 * Creates the webhook endpoint on the owner's behalf.
 *
 * This exists because the alternative does not work. Stripe replaced the
 * one-page webhook form with a three-step wizard, so the pre-filled link the
 * flow used to open arrived with nothing filled in: no events ticked, no URL
 * on the page that asks for it. Creating the endpoint through the API with
 * the key the owner already pasted removes the whole detour, and the events
 * are guaranteed to match what the worker actually handles.
 *
 * The signing secret is returned by Stripe only on this create call and never
 * again, so a caller that does not store it has to delete the endpoint and
 * make another one.
 */
export async function createWebhookEndpoint(input: {
  secretKey: string;
  url: string;
  productName: string;
}): Promise<EndpointResult> {
  const stripe = new Stripe(input.secretKey, { timeout: 10_000, maxNetworkRetries: 0 });
  try {
    const endpoint = await stripe.webhookEndpoints.create({
      url: input.url,
      enabled_events: [...REQUIRED_STRIPE_WEBHOOK_EVENTS],
      description: `Supaffi: ${input.productName}`,
    });
    if (!endpoint.secret) {
      return { ok: false, reason: "error", detail: "Stripe did not return a signing secret." };
    }
    return { ok: true, id: endpoint.id, secret: endpoint.secret };
  } catch (err) {
    const error = err as Stripe.errors.StripeError;
    // The common case by far: a key created before this permission existed,
    // or one where the row was left on Read. The screen falls back to the
    // manual path rather than dead-ending.
    if (error?.type === "StripePermissionError" || error?.statusCode === 403) {
      return { ok: false, reason: "permission", detail: "That key cannot create webhook endpoints." };
    }
    if (error?.type === "StripeInvalidRequestError") {
      return { ok: false, reason: "unreachable", detail: error.message ?? "Stripe rejected that address." };
    }
    return { ok: false, reason: "error", detail: error?.message ?? "Stripe could not be reached." };
  }
}

/** Removes an endpoint Supaffi created, so a replace does not leave a duplicate behind. */
export async function deleteWebhookEndpoint(secretKey: string, endpointId: string): Promise<void> {
  const stripe = new Stripe(secretKey);
  try {
    await stripe.webhookEndpoints.del(endpointId);
  } catch {
    // A missing or already-deleted endpoint is the state we wanted anyway,
    // and this must never block the owner from connecting a new key.
  }
}
