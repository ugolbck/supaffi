"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { updateMerchant as updateMerchantRecord, type ProductRef } from "@/lib/merchant";
import { validateProductInput, normalizeDomain } from "../../new/validation";
import { isUniqueConstraintError } from "@/lib/prismaErrors";

export async function updateMerchantAction(
  product: ProductRef,
  _prevState: { error: string },
  formData: FormData
): Promise<{ error: string } | never> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const input = {
    name: String(formData.get("name") ?? ""),
    domain: String(formData.get("domain") ?? ""),
    websiteUrl: String(formData.get("websiteUrl") ?? ""),
  };

  const validationError = validateProductInput(input);
  if (validationError) return { error: validationError };

  try {
    await updateMerchantRecord(session.user.id, product.id, {
      name: input.name.trim(),
      domain: normalizeDomain(input.domain),
      websiteUrl: input.websiteUrl.trim(),
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return { error: "That domain is already in use by another product" };
    }
    throw err;
  }

  // The sidebar and breadcrumb are rendered by the dashboard layout, which a
  // soft navigation reuses from cache. Without this the product list, the
  // breadcrumb's name lookup and the setup checklist all keep showing the
  // state from before this action ran.
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/products/${product.slug}`);
}
