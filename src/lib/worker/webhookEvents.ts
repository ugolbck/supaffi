import Stripe from "stripe";
import { db } from "@/lib/db";
import { loggableError } from "@/lib/stripeErrors";
import { decrypt } from "@/lib/crypto";
import { isLocalDomain } from "@/lib/url";
import { webhookEndpointUrl } from "@/lib/stripeWebhookLink";
import { stripeApiLocation } from "@/lib/stripeApi";
import {
  ensureRequiredWebhookEvents,
  moveWebhookEndpoint,
  type WebhookEndpointsClient,
} from "@/lib/stripeWebhookEndpoint";

type MakeClient = (secretKey: string) => WebhookEndpointsClient;

// Short and without retries, like the create call: this runs for every
// product at startup, and one slow account must not hold up the rest for
// Stripe's default 80 seconds times its retries.
function defaultClient(secretKey: string): WebhookEndpointsClient {
  return new Stripe(secretKey, {
    timeout: 10_000,
    maxNetworkRetries: 0,
    ...stripeApiLocation(),
  }) as unknown as WebhookEndpointsClient;
}

const merchantSelect = {
  id: true,
  domain: true,
  stripeSecretKeyEnc: true,
  stripeWebhookSecretEnc: true,
  stripeWebhookEndpointId: true,
} as const;

/**
 * Upgrades one product's webhook endpoint to the full event list. Never
 * throws: a failure is logged and the caller carries on. Self-hosted Supaffi
 * shows no warning UI for a failure caused by the owner's own key or a
 * webhook missing in Stripe, so the only trace of it is this log line.
 */
export async function upgradeMerchantWebhookEvents(
  merchantId: string,
  makeClient: MakeClient = defaultClient
): Promise<void> {
  try {
    const merchant = await db.merchant.findUnique({ where: { id: merchantId }, select: merchantSelect });
    // A product with no key or no webhook has nothing to upgrade, and one on
    // a local address has no endpoint at all: Stripe cannot reach it, so its
    // events come from the CLI instead.
    if (
      !merchant?.stripeSecretKeyEnc ||
      !merchant.stripeWebhookSecretEnc ||
      isLocalDomain(merchant.domain)
    ) {
      return;
    }

    const result = await ensureRequiredWebhookEvents(makeClient(decrypt(merchant.stripeSecretKeyEnc)), {
      endpointId: merchant.stripeWebhookEndpointId,
      url: webhookEndpointUrl(merchant.domain),
    });

    if (result.status === "updated") {
      console.log(`[webhook-events] added missing events to the Stripe endpoint for merchant ${merchantId}`);
    }
    if (result.status === "permission") {
      console.warn(
        `[webhook-events] the Stripe key for merchant ${merchantId} cannot update its webhook endpoint. Replace the key in settings to fix it.`
      );
    }
    if (result.status === "missing") {
      console.warn(
        `[webhook-events] the webhook endpoint for merchant ${merchantId} was not found in Stripe. Add the webhook again, then replace the secret, to fix it.`
      );
    }
    if (result.status === "error") {
      // Tried again on the next start rather than retried here.
      console.error(`[webhook-events] could not check the Stripe endpoint for merchant ${merchantId}: ${result.detail}`);
    }
  } catch (err) {
    console.error(`[webhook-events] could not check the Stripe endpoint for merchant ${merchantId}: ${loggableError(err)}`);
  }
}

/**
 * What a subdomain change did to the product's Stripe endpoint. "manual"
 * means Stripe still delivers to the old address and only the owner can fix
 * that, in Stripe.
 */
export type WebhookMove = "moved" | "manual" | "none";

/**
 * Follows a subdomain change into Stripe, called once the new domain is
 * saved. Never throws.
 *
 * Saved first, moved second: a subdomain another product already uses is
 * refused by the database before anything in Stripe changes, and an endpoint
 * moved ahead of a refused save would deliver to an address that answers for
 * no product.
 *
 * Only an endpoint Supaffi created is moved. One the owner made by hand may
 * be shared with something else of theirs, and changing it is their call.
 */
export async function moveMerchantWebhookEndpoint(
  merchantId: string,
  makeClient: MakeClient = defaultClient
): Promise<WebhookMove> {
  try {
    const merchant = await db.merchant.findUnique({ where: { id: merchantId }, select: merchantSelect });
    // No webhook means nothing in Stripe delivers to this product yet. A
    // local address has no endpoint Stripe could reach: its events come
    // from the CLI, which is pointed at the new address by hand.
    if (!merchant?.stripeWebhookSecretEnc || isLocalDomain(merchant.domain)) return "none";
    if (!merchant.stripeSecretKeyEnc || !merchant.stripeWebhookEndpointId) return "manual";

    const result = await moveWebhookEndpoint(
      makeClient(decrypt(merchant.stripeSecretKeyEnc)),
      merchant.stripeWebhookEndpointId,
      webhookEndpointUrl(merchant.domain)
    );
    if (result.ok) {
      console.log(`[webhook-move] moved the Stripe endpoint for merchant ${merchantId} to its new subdomain`);
      return "moved";
    }
    console.warn(`[webhook-move] could not move the Stripe endpoint for merchant ${merchantId}: ${result.detail}`);
    return "manual";
  } catch (err) {
    console.error(`[webhook-move] could not move the Stripe endpoint for merchant ${merchantId}: ${loggableError(err)}`);
    return "manual";
  }
}

/**
 * Runs the upgrade once for every product with Stripe connected. One product
 * at a time, so a start with many products makes a trickle of requests
 * rather than a burst, and one call each with no retry, so an account that
 * keeps failing costs one request per start and nothing more.
 */
export async function upgradeAllWebhookEvents(makeClient: MakeClient = defaultClient): Promise<void> {
  let merchants: { id: string }[];
  try {
    merchants = await db.merchant.findMany({
      where: { stripeSecretKeyEnc: { not: null }, stripeWebhookSecretEnc: { not: null } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
  } catch (err) {
    console.error("[webhook-events] could not list products to check their Stripe endpoints", err);
    return;
  }
  for (const merchant of merchants) {
    await upgradeMerchantWebhookEvents(merchant.id, makeClient);
  }
}
