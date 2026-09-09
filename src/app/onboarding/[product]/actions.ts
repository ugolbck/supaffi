"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getMerchantForOwner, updateMerchant } from "@/lib/merchant";
import { validateProductInput, normalizeDomain } from "@/app/dashboard/products/new/validation";
import { instanceDomain } from "@/lib/instance";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { stepPath } from "@/lib/onboarding";

async function owner(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  return session.user.id;
}

export async function updateSubdomainAction(
  product: { id: string; slug: string },
  _prev: { error: string },
  formData: FormData
): Promise<{ error: string }> {
  const ownerId = await owner();
  const merchant = await getMerchantForOwner(ownerId, product.id);
  if (!merchant) redirect("/onboarding");

  const domain = normalizeDomain(String(formData.get("domain") ?? ""));
  const error = validateProductInput({ name: merchant.name, domain, websiteUrl: merchant.websiteUrl }, instanceDomain());
  if (error) return { error };

  try {
    await updateMerchant(ownerId, product.id, { name: merchant.name, domain, websiteUrl: merchant.websiteUrl });
  } catch (err) {
    if (isUniqueConstraintError(err)) return { error: "Another product already uses that subdomain" };
    throw err;
  }
  revalidatePath(stepPath(product.slug, "subdomain"));
  return { error: "" };
}
