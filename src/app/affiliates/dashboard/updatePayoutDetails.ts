"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getAffiliateSession, updateAffiliatePayoutDetails } from "@/lib/affiliate";
import { getMerchantByDomain } from "@/lib/merchant";

export async function updatePayoutDetailsAction(
  payoutDetails: string
): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "affiliate") {
    return { error: "Not signed in." };
  }

  const data = await getAffiliateSession(session.user.id);
  if (!data) return { error: "Not signed in." };

  const host = (await headers()).get("host");
  const merchant = host ? await getMerchantByDomain(host) : null;
  if (!merchant || merchant.id !== data.merchantId) {
    return { error: "Not signed in." };
  }

  await updateAffiliatePayoutDetails(session.user.id, payoutDetails);
  return {};
}
