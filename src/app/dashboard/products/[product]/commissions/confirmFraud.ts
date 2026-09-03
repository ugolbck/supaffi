"use server";

import { auth } from "@/lib/auth";
import { confirmCommissionFraud } from "@/lib/commission";

export async function confirmFraudAction(
  merchantId: string,
  commissionId: string
): Promise<{ error: string } | { ok: true }> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") {
    return { error: "Not authorized" };
  }
  try {
    await confirmCommissionFraud(session.user.id, merchantId, commissionId);
    return { ok: true };
  } catch {
    return { error: "Could not void this commission" };
  }
}
