"use server";

import { requireAffiliate } from "@/lib/affiliateAuth";
import { updateAffiliatePayoutDetails } from "@/lib/affiliate";

export async function updatePayoutDetailsAction(
  payoutDetails: string
): Promise<{ error?: string }> {
  const { affiliateId } = await requireAffiliate();
  await updateAffiliatePayoutDetails(affiliateId, payoutDetails);
  return {};
}
