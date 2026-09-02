"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getProductSetup, stepAfter } from "@/lib/productSetup";
import { auth } from "@/lib/auth";
import { createProgram as createProgramRecord } from "@/lib/program";
import { validateProgramInput } from "./validation";

export async function createProgramAction(
  merchantId: string,
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

  await createProgramRecord(session.user.id, merchantId, result.parsed);
  // The sidebar and breadcrumb are rendered by the dashboard layout, which a
  // soft navigation reuses from cache. Without this the product list, the
  // breadcrumb's name lookup and the setup checklist all keep showing the
  // state from before this action ran.
  revalidatePath("/dashboard", "layout");

  // Straight on to whatever is still missing, rather than back to the product
  // page. Setup is a sequence, and dropping the Owner at the overview after
  // every step makes them find their own way back into it.
  const setup = await getProductSetup(session.user.id, merchantId);
  const next = stepAfter(merchantId, setup, 2);
  redirect(next?.href ?? `/dashboard/products/${merchantId}`);
}
