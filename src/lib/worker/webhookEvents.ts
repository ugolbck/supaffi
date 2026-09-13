import Stripe from "stripe";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { isLocalDomain } from "@/lib/url";
import { webhookEndpointUrl } from "@/lib/stripeWebhookLink";
import {
  ensureRequiredWebhookEvents,
  type WebhookEndpointsClient,
} from "@/lib/stripeWebhookEndpoint";
import { recordWebhookEventsProblem } from "@/lib/webhookEventsProblem";

type MakeClient = (secretKey: string) => WebhookEndpointsClient;

// Short and without retries, like the create call: this runs for every
// product at startup, and one slow account must not hold up the rest for
// Stripe's default 80 seconds times its retries.
function defaultClient(secretKey: string): WebhookEndpointsClient {
  return new Stripe(secretKey, {
    timeout: 10_000,
    maxNetworkRetries: 0,
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
 * Upgrades one product's webhook endpoint to the full event list, and records
 * what the settings page should say about it. Never throws: a failure is
 * logged and the caller carries on.
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
      recordWebhookEventsProblem(merchantId, null);
      return;
    }

    const result = await ensureRequiredWebhookEvents(makeClient(decrypt(merchant.stripeSecretKeyEnc)), {
      endpointId: merchant.stripeWebhookEndpointId,
      url: webhookEndpointUrl(merchant.domain),
    });

    if (result.status === "updated") {
      console.log(`[webhook-events] added missing events to the Stripe endpoint for merchant ${merchantId}`);
    }
    if (result.status === "permission" || result.status === "missing") {
      console.warn(
        `[webhook-events] could not update the Stripe endpoint for merchant ${merchantId}: ${result.detail} Some sales will earn no commission until this is fixed.`
      );
    }
    if (result.status === "error") {
      // Left unrecorded on purpose, see webhookEventsProblem.ts. It is tried
      // again on the next start rather than retried here.
      console.error(`[webhook-events] could not check the Stripe endpoint for merchant ${merchantId}: ${result.detail}`);
      return;
    }
    recordWebhookEventsProblem(
      merchantId,
      result.status === "permission" || result.status === "missing" ? result.status : null
    );
  } catch (err) {
    console.error(`[webhook-events] could not check the Stripe endpoint for merchant ${merchantId}`, err);
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
