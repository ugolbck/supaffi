"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { updateProgram as updateProgramRecord } from "@/lib/program";
import { validateProgramInput } from "../../new/validation";

export async function updateProgramAction(
  merchantId: string,
  programId: string,
  _prevState: { error: string },
  formData: FormData
): Promise<{ error: string } | never> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const result = validateProgramInput({
    name: String(formData.get("name") ?? ""),
    defaultCommissionRate: String(formData.get("defaultCommissionRate") ?? ""),
    commissionDurationType: String(formData.get("commissionDurationType") ?? ""),
    commissionDurationMonths: String(formData.get("commissionDurationMonths") ?? ""),
    attributionWindowDays: String(formData.get("attributionWindowDays") ?? ""),
    holdingPeriodDays: String(formData.get("holdingPeriodDays") ?? ""),
  });
  if (result.error !== null) return { error: result.error };

  await updateProgramRecord(session.user.id, merchantId, programId, result.parsed);
  redirect(`/dashboard/merchants/${merchantId}`);
}
