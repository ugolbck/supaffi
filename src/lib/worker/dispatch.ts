import type { WebhookEvent } from "@prisma/client";
import { db } from "@/lib/db";
import { paymentProviderFor } from "@/lib/payments";

/** Hands a queued event to the provider of the product it was delivered to. */
export async function processWebhookEvent(row: WebhookEvent): Promise<void> {
  const merchant = await db.merchant.findUniqueOrThrow({ where: { id: row.merchantId } });
  await paymentProviderFor(merchant).processEvent(merchant, row.payload);
}
