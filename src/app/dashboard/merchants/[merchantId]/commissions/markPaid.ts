"use server";

import { auth } from "@/lib/auth";
import { markPayoutGroupPaid } from "@/lib/commission";

export async function markPaidAction(
  merchantId: string,
  affiliateId: string,
  currency: string,
  commissionIds: string[]
): Promise<{ error: string } | { count: number }> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") {
    return { error: "Not authorized" };
  }
  try {
    return await markPayoutGroupPaid(
      session.user.id,
      merchantId,
      affiliateId,
      currency,
      commissionIds
    );
  } catch {
    return { error: "Could not mark this payout as paid" };
  }
}
