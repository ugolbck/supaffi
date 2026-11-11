import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { isLocalDomain } from "@/lib/url";
import type { WebhookMove } from "@/lib/payments/types";
import { polarLoggableError } from "@/lib/payments/polar/api";
import { ensurePolarWebhookEvents, movePolarWebhookEndpoint } from "@/lib/payments/polar/connect";
import { polarWebhookUrl } from "@/lib/payments/polar/webhookEvents";

const merchantSelect = {
  id: true,
  domain: true,
  paymentSandbox: true,
  paymentKeyEnc: true,
  webhookSecretEnc: true,
  webhookEndpointId: true,
} as const;

/**
 * Follows a subdomain change into Polar, once the new domain is saved. Never
 * throws. Only an endpoint Supaffi created is moved; one the owner made by
 * hand is theirs to change.
 */
export async function movePolarEndpoint(merchantId: string): Promise<WebhookMove> {
  try {
    const merchant = await db.merchant.findUnique({ where: { id: merchantId }, select: merchantSelect });
    if (!merchant?.webhookSecretEnc || isLocalDomain(merchant.domain)) return "none";
    if (!merchant.paymentKeyEnc || !merchant.webhookEndpointId) return "manual";
    await movePolarWebhookEndpoint(
      { token: decrypt(merchant.paymentKeyEnc), sandbox: merchant.paymentSandbox },
      merchant.webhookEndpointId,
      polarWebhookUrl(merchant.domain)
    );
    console.log(`[webhook-move] moved the Polar endpoint for merchant ${merchantId} to its new subdomain`);
    return "moved";
  } catch (err) {
    console.warn(`[webhook-move] could not move the Polar endpoint for merchant ${merchantId}: ${polarLoggableError(err)}`);
    return "manual";
  }
}

/**
 * Brings every endpoint Supaffi created in Polar up to the events this release
 * handles, one product at a time. Never throws; a failure is logged.
 */
export async function upgradePolarEndpoints(): Promise<void> {
  let merchants;
  try {
    merchants = await db.merchant.findMany({
      where: { paymentProvider: "POLAR", paymentKeyEnc: { not: null }, webhookEndpointId: { not: null } },
      select: merchantSelect,
      orderBy: { createdAt: "asc" },
    });
  } catch (err) {
    console.error("[webhook-events] could not list products to check their Polar endpoints", err);
    return;
  }
  for (const merchant of merchants) {
    if (isLocalDomain(merchant.domain)) continue;
    try {
      const changed = await ensurePolarWebhookEvents(
        { token: decrypt(merchant.paymentKeyEnc!), sandbox: merchant.paymentSandbox },
        merchant.webhookEndpointId!
      );
      if (changed) console.log(`[webhook-events] added missing events to the Polar endpoint for merchant ${merchant.id}`);
    } catch (err) {
      console.error(`[webhook-events] could not check the Polar endpoint for merchant ${merchant.id}: ${polarLoggableError(err)}`);
    }
  }
}
