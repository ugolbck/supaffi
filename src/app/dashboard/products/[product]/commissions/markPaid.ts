"use server";

import { auth } from "@/lib/auth";
import { markCommissionsPaid, type MarkPaidResult } from "@/lib/commission";

export async function markPaidAction(
  merchantId: string,
  commissionIds: string[]
): Promise<MarkPaidResult> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") {
    return { error: "Not authorized" };
  }
  try {
    return await markCommissionsPaid(session.user.id, merchantId, commissionIds);
  } catch {
    return { error: "Could not mark those commissions as paid" };
  }
}
