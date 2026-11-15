"use server";

import { requireOwner } from "@/app/requireOwner";
import { getMerchantForOwner } from "@/lib/merchant";
import { markTrackingCelebrationSeen } from "@/lib/tracking";

// Called by the celebration banner once it has rendered. Ownership is checked
// here rather than trusted from the client: a Server Action is a public
// endpoint, and the merchant id arrives from the browser.
export async function markTrackingSeen(merchantId: string): Promise<void> {
  const merchant = await getMerchantForOwner(await requireOwner(), merchantId);
  if (!merchant) return;

  await markTrackingCelebrationSeen(merchantId);
}
