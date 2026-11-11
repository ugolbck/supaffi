import type { CheckResult } from "@/lib/checks/dns";
import { isPolarApiError, polarRequest, type PolarConnection } from "@/lib/payments/polar/api";
import { POLAR_WEBHOOK_EVENTS } from "@/lib/payments/polar/webhookEvents";

type Endpoint = { id: string; url: string; events: string[]; secret?: string };

/**
 * The scopes the token needs, all of them for the webhook endpoint. Sales
 * arrive whole on the webhook, so the token never reads an order.
 */
export const POLAR_TOKEN_SCOPES = ["webhooks:read", "webhooks:write"] as const;

export type TokenCheck = (CheckResult & { ok: false }) | { ok: true; detail: string; sandbox: boolean };

/**
 * One read with the token, before it is stored, which also finds the
 * environment it belongs to. A token works on Polar's production or its
 * sandbox, never both, and does not say which ("polar_oat_" on either), so
 * production is asked first and the sandbox only when production does not
 * know the token.
 */
export async function polarTokenWorks(token: string): Promise<TokenCheck> {
  if (!token.startsWith("polar_oat_")) {
    return { ok: false, detail: "That is not a Polar organization access token" };
  }
  for (const sandbox of [false, true]) {
    try {
      await polarRequest({ token, sandbox }, "GET", "/v1/webhooks/endpoints?limit=1");
      return { ok: true, detail: "Token works", sandbox };
    } catch (err) {
      if (isPolarApiError(err) && err.status === 401) continue;
      if (isPolarApiError(err) && err.status === 403) {
        return { ok: false, detail: "The token is missing a scope. It needs webhooks:read and webhooks:write." };
      }
      return { ok: false, detail: "Could not reach Polar" };
    }
  }
  return { ok: false, detail: "Polar says this token is not valid" };
}

export type PolarEndpointResult =
  | { ok: true; id: string; secret: string }
  | { ok: false; detail: string };

/**
 * Creates the product's webhook endpoint. Polar generates the signing secret
 * and returns it on this call (polar.sh/docs/api-reference/2026-10/webhooks/create-webhook-endpoint).
 */
export async function createPolarWebhookEndpoint(connection: PolarConnection, url: string, name: string): Promise<PolarEndpointResult> {
  try {
    const endpoint = await polarRequest<Endpoint>(connection, "POST", "/v1/webhooks/endpoints", {
      url,
      name: `Supaffi: ${name}`.slice(0, 100),
      format: "raw",
      events: [...POLAR_WEBHOOK_EVENTS],
    });
    if (!endpoint.secret) return { ok: false, detail: "Polar did not return a signing secret." };
    return { ok: true, id: endpoint.id, secret: endpoint.secret };
  } catch (err) {
    if (isPolarApiError(err) && err.status === 403) return { ok: false, detail: "That token cannot create webhook endpoints." };
    if (isPolarApiError(err) && err.status === 422) return { ok: false, detail: "Polar rejected that address." };
    return { ok: false, detail: "Polar could not be reached." };
  }
}

/** Points the endpoint at a new address. Events, secret and status stay as they are. */
export async function movePolarWebhookEndpoint(connection: PolarConnection, endpointId: string, url: string): Promise<boolean> {
  await polarRequest(connection, "PATCH", `/v1/webhooks/endpoints/${encodeURIComponent(endpointId)}`, { url });
  return true;
}

/**
 * Adds any event a later release handles to an endpoint Supaffi created,
 * keeping every event already there. Returns whether it changed anything.
 */
export async function ensurePolarWebhookEvents(connection: PolarConnection, endpointId: string): Promise<boolean> {
  const path = `/v1/webhooks/endpoints/${encodeURIComponent(endpointId)}`;
  const endpoint = await polarRequest<Endpoint>(connection, "GET", path);
  const missing = POLAR_WEBHOOK_EVENTS.filter((event) => !endpoint.events.includes(event));
  if (missing.length === 0) return false;
  await polarRequest(connection, "PATCH", path, { events: [...endpoint.events, ...missing] });
  return true;
}

/** Removes an endpoint Supaffi created. A missing one is the state wanted anyway. */
export async function deletePolarWebhookEndpoint(connection: PolarConnection, endpointId: string): Promise<void> {
  try {
    await polarRequest(connection, "DELETE", `/v1/webhooks/endpoints/${encodeURIComponent(endpointId)}`);
  } catch {
    // Never blocks the owner from connecting a new token.
  }
}
