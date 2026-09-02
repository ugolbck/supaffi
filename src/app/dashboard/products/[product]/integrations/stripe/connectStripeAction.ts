"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import type { ProductRef } from "@/lib/merchant";
import { connectStripe } from "@/lib/merchant";
import { validateStripeCredentials } from "../../../new/validation";

export async function connectStripeAction(
  product: ProductRef,
  alreadyConnected: boolean,
  _prevState: { error: string },
  formData: FormData
): Promise<{ error: string } | never> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const secretKey = String(formData.get("secretKey") ?? "").trim();
  const webhookSecret = String(formData.get("webhookSecret") ?? "").trim();

  // Reconnecting: a blank field means "keep what is stored". On a first
  // connect both are required, because there is nothing to keep.
  const validationError = validateStripeCredentials(
    { secretKey, webhookSecret },
    alreadyConnected
  );
  if (validationError) return { error: validationError };

  if (alreadyConnected && !secretKey && !webhookSecret) {
    // Nothing was written, so nothing to revalidate.
    redirect(`/dashboard/products/${product.slug}/integrations`);
  }

  await connectStripe(session.user.id, product.id, { secretKey, webhookSecret });
  // The sidebar and breadcrumb are rendered by the dashboard layout, which a
  // soft navigation reuses from cache. Without this the product list, the
  // breadcrumb's name lookup and the setup checklist all keep showing the
  // state from before this action ran.
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/products/${product.slug}/integrations`);
}
