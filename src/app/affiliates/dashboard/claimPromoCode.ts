"use server";

import { revalidatePath } from "next/cache";
import { requireAffiliate } from "@/lib/affiliateAuth";
import { claimPromoCode } from "@/lib/promoCode";

/**
 * The Affiliate claiming their code from the Overview. A key the Owner has
 * not updated yet is the Owner's to fix, so the Affiliate is told only that
 * codes are not available, never about keys or permissions.
 */
export async function claimPromoCodeAction(code: string): Promise<{ error: string } | null> {
  const { affiliateId } = await requireAffiliate();
  const result = await claimPromoCode(affiliateId, code);
  if (!result.ok) return { error: result.keyLacksPermission ? "Codes aren't available yet. Try again later." : result.error };
  revalidatePath("/affiliates/dashboard", "layout");
  return null;
}
