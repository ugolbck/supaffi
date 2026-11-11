import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { connectPaymentProvider } from "@/lib/merchant";
import { isLocalDomain } from "@/lib/url";
import { isPolarApiError, polarRequest, type PolarConnection } from "@/lib/payments/polar/api";
import { createPolarWebhookEndpoint, deletePolarWebhookEndpoint, polarTokenWorks } from "@/lib/payments/polar/connect";
import { polarWebhookUrl } from "@/lib/payments/polar/webhookEvents";

/**
 * Stores a Polar token for a product, first making sure Polar delivers to it
 * with that token's organization and environment. One path for onboarding and
 * for replacing the token in settings.
 *
 * A first token creates the endpoint. A replacement keeps the endpoint when
 * the new token can see it. When it cannot, the token belongs to another
 * organization or environment (a sandbox token replaced with a production
 * one, most often), and the old endpoint would keep delivering that one's
 * events while the new one sent none: it is removed with the old token and a
 * new one is created. An endpoint the owner made by hand (a pasted secret, no
 * stored id) is theirs and is left alone.
 *
 * Nothing is stored unless all of it worked, so a failure leaves the product
 * as it was.
 */
export async function connectPolarToken(ownerId: string, merchantId: string, token: string): Promise<{ error: string } | { error: null }> {
  const check = await polarTokenWorks(token);
  if (!check.ok) return { error: check.detail };
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { name: true, domain: true, paymentKeyEnc: true, paymentSandbox: true, webhookSecretEnc: true, webhookEndpointId: true },
  });
  if (!merchant) return { error: "Product not found" };
  const connection: PolarConnection = { token, sandbox: check.sandbox };

  // Polar refuses a webhook address on a local machine, so a local instance
  // stores the token alone.
  const handMade = merchant.webhookSecretEnc && !merchant.webhookEndpointId;
  if (isLocalDomain(merchant.domain) || handMade) {
    await connectPaymentProvider(ownerId, merchantId, { secretKey: token, sandbox: check.sandbox });
    return { error: null };
  }

  if (merchant.webhookEndpointId) {
    const seen = await endpointSeenBy(connection, merchant.webhookEndpointId);
    if (seen === "unreachable") return { error: "Could not reach Polar" };
    if (seen === "yes") {
      await connectPaymentProvider(ownerId, merchantId, { secretKey: token, sandbox: check.sandbox });
      return { error: null };
    }
  }

  const created = await createPolarWebhookEndpoint(connection, polarWebhookUrl(merchant.domain), merchant.name);
  if (!created.ok) return { error: created.detail };
  if (merchant.webhookEndpointId && merchant.paymentKeyEnc) {
    const previous = previousConnection(merchant.paymentKeyEnc, merchant.paymentSandbox);
    if (previous) await deletePolarWebhookEndpoint(previous, merchant.webhookEndpointId);
  }
  await connectPaymentProvider(ownerId, merchantId, {
    secretKey: token,
    webhookSecret: created.secret,
    webhookEndpointId: created.id,
    sandbox: check.sandbox,
  });
  return { error: null };
}

async function endpointSeenBy(connection: PolarConnection, endpointId: string): Promise<"yes" | "no" | "unreachable"> {
  try {
    await polarRequest(connection, "GET", `/v1/webhooks/endpoints/${encodeURIComponent(endpointId)}`);
    return "yes";
  } catch (err) {
    if (isPolarApiError(err) && err.status >= 400 && err.status < 500) return "no";
    return "unreachable";
  }
}

function previousConnection(keyEnc: string, sandbox: boolean): PolarConnection | null {
  try {
    return { token: decrypt(keyEnc), sandbox };
  } catch {
    return null;
  }
}
