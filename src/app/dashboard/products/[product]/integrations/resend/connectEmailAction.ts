"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import type { ProductRef } from "@/lib/merchant";
import { connectEmailProvider } from "@/lib/merchant";
import { validateEmailProviderKey } from "../../../new/validation";

export async function connectEmailAction(
  product: ProductRef,
  alreadyConnected: boolean,
  _prevState: { error: string },
  formData: FormData
): Promise<{ error: string } | never> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const apiKey = String(formData.get("apiKey") ?? "").trim();

  const validationError = validateEmailProviderKey(apiKey, alreadyConnected);
  if (validationError) return { error: validationError };

  // Blank on a reconnect means "keep the stored key", so there is nothing
  // to write. Never encrypt an empty string over a live credential.
  if (apiKey) {
    await connectEmailProvider(session.user.id, product.id, apiKey);
  }

  // The sidebar and breadcrumb are rendered by the dashboard layout, which a
  // soft navigation reuses from cache. Without this the product list, the
  // breadcrumb's name lookup and the setup checklist all keep showing the
  // state from before this action ran.
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/products/${product.slug}/integrations`);
}
