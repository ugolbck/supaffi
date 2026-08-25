"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createProgram as createProgramRecord } from "@/lib/program";
import { validateProgramInput } from "./validation";

export async function createProgramAction(
  merchantId: string,
  _prevState: { error: string },
  formData: FormData
): Promise<{ error: string } | never> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const result = validateProgramInput({
    name: String(formData.get("name") ?? ""),
    defaultCommissionRate: String(formData.get("defaultCommissionRate") ?? ""),
    commissionDurationType: String(formData.get("commissionDurationType") ?? ""),
    commissionDurationMonths: String(formData.get("commissionDurationMonths") ?? ""),
    attributionWindowDays: String(formData.get("attributionWindowDays") ?? ""),
    holdingPeriodDays: String(formData.get("holdingPeriodDays") ?? ""),
  });
  if (result.error !== null) return { error: result.error };

  await createProgramRecord(session.user.id, merchantId, result.parsed);
  redirect(`/dashboard/merchants/${merchantId}`);
}
