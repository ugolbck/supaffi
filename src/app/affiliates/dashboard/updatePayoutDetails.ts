"use server";

import { revalidatePath } from "next/cache";
import { requireAffiliate } from "@/lib/affiliateAuth";
import { updateAffiliatePayoutDetails } from "@/lib/affiliate";

export async function updatePayoutDetailsAction(
  payoutDetails: string
): Promise<{ error?: string }> {
  const { affiliateId } = await requireAffiliate();
  await updateAffiliatePayoutDetails(affiliateId, payoutDetails);
  // As a layout: the sidebar's waiting dot reads the same row, so a save that
  // only refreshed this page would leave the dot lit until a reload.
  revalidatePath("/affiliates/dashboard", "layout");
  return {};
}
