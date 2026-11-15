import { db } from "@/lib/db";
import { checkDomainOwnership, type DomainOwnership } from "@/lib/domainOwnership";
import { paymentProviderFor } from "@/lib/payments";
import type { WebhookMove } from "@/lib/payments/types";

/**
 * Checks a product's domain proof, and on the check that proves a domain the
 * product moved to, points its payment webhook at it. Until then the webhook
 * stays on the proven domain the product moved away from, which is still
 * served, so no event is refused in between. Separate from domainOwnership so
 * the product writes there do not pull in the payment providers.
 */
export async function proveDomain(
  ownerId: string,
  merchantId: string,
  check: typeof checkDomainOwnership = checkDomainOwnership
): Promise<(DomainOwnership & { webhook: WebhookMove }) | null> {
  const ownership = await check(ownerId, merchantId);
  if (!ownership) return null;
  if (!ownership.moved) return { ...ownership, webhook: "none" };
  const merchant = await db.merchant.findFirst({ where: { id: merchantId, ownerId }, select: { paymentProvider: true } });
  const move = merchant && paymentProviderFor(merchant).moveWebhookEndpoint;
  return { ...ownership, webhook: move ? await move(merchantId) : "none" };
}
