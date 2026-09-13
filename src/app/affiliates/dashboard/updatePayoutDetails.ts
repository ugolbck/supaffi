"use server";

import { revalidatePath } from "next/cache";
import { requireAffiliate } from "@/lib/affiliateAuth";
import { updateAffiliatePayoutDetails } from "@/lib/affiliate";

export async function updatePayoutDetailsAction(
  payoutDetails: unknown
): Promise<{ error?: string }> {
  const { affiliateId } = await requireAffiliate();
  // A server action is a public endpoint whatever its TypeScript signature
  // says, so the argument is checked rather than trusted to be a string.
  if (typeof payoutDetails !== "string") return { error: "Could not save that" };
  const failed = await updateAffiliatePayoutDetails(affiliateId, payoutDetails);
  if (failed) return failed;
  // As a layout: the sidebar's waiting dot reads the same row, so a save that
  // only refreshed this page would leave the dot lit until a reload.
  revalidatePath("/affiliates/dashboard", "layout");
  return {};
}
