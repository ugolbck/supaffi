"use server";

import { auth } from "@/lib/auth";
import { dismissCommissionFlag } from "@/lib/commission";

export async function dismissFlagAction(
  merchantId: string,
  commissionId: string
): Promise<{ error: string } | { ok: true }> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") {
    return { error: "Not authorized" };
  }
  try {
    await dismissCommissionFlag(session.user.id, merchantId, commissionId);
    return { ok: true };
  } catch {
    return { error: "Could not dismiss this flag" };
  }
}
