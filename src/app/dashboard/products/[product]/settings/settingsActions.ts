"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  updateMerchant,
  deleteMerchant,
  connectStripe,
  connectEmailProvider,
  getMerchantForOwner,
  type ProductRef,
} from "@/lib/merchant";
import { validateProductInput, normalizeDomain } from "@/app/dashboard/products/new/validation";
import { instanceDomain } from "@/lib/instance";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { stripeKeyWorks } from "@/lib/checks/stripe";
import { resendKeyWorks } from "@/lib/checks/email";

/**
 * Everything the settings page can change: the product's own details, the
 * three credentials it holds, and the product itself.
 *
 * Each replace action checks the credential before it stores it, the same way
 * onboarding does, so a key that does not work fails on the screen that can
 * fix it rather than on the first sale weeks later. They redirect back to
 * settings instead of forward into the next onboarding step, which is the one
 * thing that separates them from their onboarding twins.
 */

async function owner(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  return session.user.id;
}

const settings = (slug: string) => `/dashboard/products/${slug}/settings`;

export async function updateProductAction(
  product: ProductRef,
  _prev: { error: string },
  formData: FormData
): Promise<{ error: string }> {
  const ownerId = await owner();
  const input = {
    name: String(formData.get("name") ?? "").trim(),
    domain: normalizeDomain(String(formData.get("domain") ?? "")),
    websiteUrl: String(formData.get("websiteUrl") ?? "").trim(),
  };
  const error = validateProductInput(input, instanceDomain());
  if (error) return { error };
  try {
    await updateMerchant(ownerId, product.id, input);
  } catch (err) {
    if (isUniqueConstraintError(err)) return { error: "Another product already uses that subdomain" };
    throw err;
  }
  // The sidebar and the product switcher are rendered by the dashboard layout,
  // which a soft navigation reuses from cache.
  revalidatePath("/dashboard", "layout");
  return { error: "" };
}

export async function replaceStripeKeyAction(
  product: ProductRef,
  _prev: { error: string },
  formData: FormData
): Promise<{ error: string }> {
  const ownerId = await owner();
  const key = String(formData.get("value") ?? "").trim();
  const check = await stripeKeyWorks(key);
  if (!check.ok) return { error: check.detail };
  await connectStripe(ownerId, product.id, { secretKey: key });
  redirect(settings(product.slug));
}

export async function replaceWebhookSecretAction(
  product: ProductRef,
  _prev: { error: string },
  formData: FormData
): Promise<{ error: string }> {
  const ownerId = await owner();
  const secret = String(formData.get("value") ?? "").trim();
  if (!secret.startsWith("whsec_")) return { error: "The signing secret starts with whsec_" };
  await connectStripe(ownerId, product.id, { webhookSecret: secret });
  redirect(settings(product.slug));
}

export async function replaceEmailKeyAction(
  product: ProductRef,
  _prev: { error: string },
  formData: FormData
): Promise<{ error: string }> {
  const ownerId = await owner();
  const key = String(formData.get("value") ?? "").trim();
  const check = await resendKeyWorks(key);
  if (!check.ok) return { error: check.detail };
  await connectEmailProvider(ownerId, product.id, key);
  redirect(settings(product.slug));
}

export async function deleteProductAction(product: ProductRef, formData: FormData): Promise<void> {
  const ownerId = await owner();
  const merchant = await getMerchantForOwner(ownerId, product.id);
  if (!merchant) redirect("/dashboard");
  // Typing the name is the confirmation. A dialog button alone is one
  // misclick from a year of commission history.
  if (String(formData.get("confirm") ?? "") !== merchant.name) redirect(settings(product.slug));
  await deleteMerchant(ownerId, product.id);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}
