"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createProgram, programDiscount, updateProgram } from "@/lib/program";
import { NO_DISCOUNT, validateProgramInput } from "@/lib/programValidation";

/**
 * Creating and editing a program, from the sheet on the list. Both end on the
 * list with the sheet closed, which is what the redirect is for: the URL is
 * what opened the panel, so the URL is what has to close it.
 */

function read(formData: FormData) {
  const result = validateProgramInput({
    name: String(formData.get("name") ?? ""),
    defaultCommissionRate: String(formData.get("defaultCommissionRate") ?? ""),
    commissionDurationType: String(formData.get("commissionDurationType") ?? ""),
    commissionDurationMonths: String(formData.get("commissionDurationMonths") ?? ""),
    attributionWindowDays: String(formData.get("attributionWindowDays") ?? ""),
    holdingPeriodDays: String(formData.get("holdingPeriodDays") ?? ""),
  });
  if (result.error !== null) return result;
  return { error: null, parsed: { ...result.parsed, signupOpen: formData.get("signupOpen") === "on" } };
}

/**
 * The discount picked on the form, or nothing to change when the form had no
 * discount field (Stripe not connected, or its coupons could not be listed).
 */
async function discount(ownerId: string, productId: string, programId: string | null, formData: FormData) {
  if (!formData.has("discountRef")) return { error: null };
  const picked = String(formData.get("discountRef"));
  return programDiscount(ownerId, productId, programId, picked === NO_DISCOUNT ? "" : picked);
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
  const { error, ...coupon } = await discount(ownerId, product.id, null, formData);
  if (error !== null) return { error };
  await createProgram(ownerId, product.id, { ...result.parsed, ...coupon });
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
  const { error, ...coupon } = await discount(ownerId, product.id, programId, formData);
  if (error !== null) return { error };
  await updateProgram(ownerId, product.id, programId, { ...result.parsed, ...coupon });
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/products/${product.slug}/programs`);
}
