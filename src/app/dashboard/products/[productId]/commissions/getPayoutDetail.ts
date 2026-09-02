"use server";

import { auth } from "@/lib/auth";
import { getPayoutGroupDetail } from "@/lib/commission";
import type { PayoutCommissionLine } from "@/lib/commission";

export async function getPayoutDetailAction(
  merchantId: string,
  affiliateId: string,
  currency: string
): Promise<PayoutCommissionLine[]> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") return [];
  return getPayoutGroupDetail(session.user.id, merchantId, affiliateId, currency);
}
