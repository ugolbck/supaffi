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

type EndpointShape = { id: string; url: string; enabled_events: string[] };

/** The three calls the event upgrade makes, so a test can hand in a fake. */
export type WebhookEndpointsClient = {
  webhookEndpoints: {
    retrieve: (id: string) => Promise<EndpointShape>;
    list: (params: { limit: number }) => Promise<{ data: EndpointShape[] }>;
    update: (id: string, params: { enabled_events: string[] }) => Promise<unknown>;
  };
};

export type EventsUpgradeResult =
  | { status: "current" | "updated" }
  | { status: "missing" | "permission" | "error"; detail: string };

function isMissing(err: unknown): boolean {
  const error = err as Stripe.errors.StripeError;
  return error?.code === "resource_missing" || error?.statusCode === 404;
}

function isPermission(err: unknown): boolean {
  const error = err as Stripe.errors.StripeError;
  return error?.type === "StripePermissionError" || error?.statusCode === 403;
}

/**
 * Brings an existing endpoint up to every event the worker handles.
 *
 * The event list only ever reached Stripe on the create call, so an endpoint
 * made by an earlier release keeps the list that release had and silently
 * never delivers the events added since. This adds whatever is missing and
 * keeps every event already there, since the owner may have ticked extras
 * for their own reasons.
 *
 * The stored id is tried first. Without one, or when Stripe no longer has it,
 * the endpoint is found by the address it delivers to, which is how an
 * endpoint the owner made by hand, or one made before the id was stored, is
 * still reached. Every endpoint pointing at that address is upgraded, because
 * a duplicate that is left behind still delivers and still drops sales.
 */
export async function ensureRequiredWebhookEvents(
  client: WebhookEndpointsClient,
  target: { endpointId: string | null; url: string }
): Promise<EventsUpgradeResult> {
  try {
    let endpoints: EndpointShape[] = [];
    if (target.endpointId) {
      try {
        endpoints = [await client.webhookEndpoints.retrieve(target.endpointId)];
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
    }
    if (endpoints.length === 0) {
      // Stripe caps an account at 16 endpoints, so one page of 100 is all of them.
      const page = await client.webhookEndpoints.list({ limit: 100 });
      endpoints = page.data.filter((endpoint) => endpoint.url === target.url);
    }
    if (endpoints.length === 0) {
      return { status: "missing", detail: "No webhook endpoint in Stripe points at this product." };
    }

    let updated = false;
    for (const endpoint of endpoints) {
      if (endpoint.enabled_events.includes("*")) continue;
      const missing = REQUIRED_STRIPE_WEBHOOK_EVENTS.filter(
        (event) => !endpoint.enabled_events.includes(event)
      );
      if (missing.length === 0) continue;
      await client.webhookEndpoints.update(endpoint.id, {
        enabled_events: [...endpoint.enabled_events, ...missing],
      });
      updated = true;
    }
    return { status: updated ? "updated" : "current" };
  } catch (err) {
    if (isPermission(err)) {
      return { status: "permission", detail: "The key cannot change webhook endpoints." };
    }
    return {
      status: "error",
      detail: (err as Stripe.errors.StripeError)?.message ?? "Stripe could not be reached.",
    };
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
