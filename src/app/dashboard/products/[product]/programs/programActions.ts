"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createProgram, updateProgram } from "@/lib/program";
import { validateProgramInput } from "@/lib/programValidation";

/**
 * Creating and editing a program, from the sheet on the list. Both end on the
 * list with the sheet closed, which is what the redirect is for: the URL is
 * what opened the panel, so the URL is what has to close it.
 */

function read(formData: FormData) {
  return validateProgramInput({
    name: String(formData.get("name") ?? ""),
    defaultCommissionRate: String(formData.get("defaultCommissionRate") ?? ""),
    commissionDurationType: String(formData.get("commissionDurationType") ?? ""),
    commissionDurationMonths: String(formData.get("commissionDurationMonths") ?? ""),
    attributionWindowDays: String(formData.get("attributionWindowDays") ?? ""),
    holdingPeriodDays: String(formData.get("holdingPeriodDays") ?? ""),
  });
}

async function owner(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  return session.user.id;
}

export async function createProgramAction(
  product: { id: string; slug: string },
  _prev: { error: string },
  formData: FormData
): Promise<{ error: string }> {
  const ownerId = await owner();
  const result = read(formData);
  if (result.error !== null) return { error: result.error };
  await createProgram(ownerId, product.id, result.parsed);
  // The sidebar counts programs and is rendered by the dashboard layout, which
  // a soft navigation reuses from cache.
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/products/${product.slug}/programs`);
}

export async function updateProgramAction(
  product: { id: string; slug: string },
  programId: string,
  _prev: { error: string },
  formData: FormData
): Promise<{ error: string }> {
  const ownerId = await owner();
  const result = read(formData);
  if (result.error !== null) return { error: result.error };
  await updateProgram(ownerId, product.id, programId, result.parsed);
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/products/${product.slug}/programs`);
}
