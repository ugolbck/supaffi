import { db } from "@/lib/db";
import type { CheckResult } from "@/lib/checks/dns";

/**
 * Whether the payment provider has delivered any event at all to this
 * product's endpoint.
 * Scoped by owner as well as by product, the same rule the rest of the library
 * follows: every read proves ownership in its own query rather than trusting
 * the id it was handed.
 */
export async function webhookEventReceived(
  ownerId: string,
  merchantId: string
): Promise<CheckResult> {
  const any = await db.webhookEvent.findFirst({
    where: { merchantId, merchant: { ownerId } },
    select: { id: true },
  });
  return any
    ? { ok: true, detail: "Events are arriving" }
    : { ok: false, detail: "Waiting for the first event" };
}
