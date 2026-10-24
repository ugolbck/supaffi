"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  updateMerchant,
  deleteMerchant,
  connectStripe,
  getMerchantForOwner,
  type ProductRef,
} from "@/lib/merchant";
import { validateProductInput, normalizeDomain, normalizeWebsiteUrl } from "@/lib/productValidation";
import { instanceDomain } from "@/lib/instance";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { stripeKeyWorks } from "@/lib/checks/stripe";
import { upgradeMerchantWebhookEvents } from "@/lib/worker/webhookEvents";

/**
 * Everything the settings page can change: the product's own details, the
 * three credentials it holds, and the product itself.
 *
 * Each replace action checks the credential before it stores it, the same way
 * onboarding does, so a key that does not work fails on the screen that can
 * fix it rather than on the first sale weeks later. They redirect back to
 * settings instead of forward into the next onboarding step, which is the one
 * thing that separates them from their onboarding twins.
 *
 * Each redirect names the section it just changed. `runProductChecks` serves a
 * section it ran less than a minute ago from its cache, so without this the
 * light for the very thing that was just fixed can still read "not connected"
 * on the page the owner lands on.
 */

async function owner(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  return session.user.id;
}

/** The settings URL, optionally asking for one section of checks to be re-run. */
const settings = (slug: string, fresh?: "dns" | "stripe") =>
  `/dashboard/products/${slug}/settings${fresh ? `?fresh=${fresh}` : ""}`;

type ProductFormState = { error: string; values?: { name: string; domain: string; websiteUrl: string } };

export async function updateProductAction(
  product: ProductRef,
  _prev: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  const ownerId = await owner();
  const input = {
    name: String(formData.get("name") ?? "").trim(),
    domain: normalizeDomain(String(formData.get("domain") ?? "")),
    websiteUrl: normalizeWebsiteUrl(String(formData.get("websiteUrl") ?? "")),
  };
  // A refusal hands back what was typed, so the form shows it again instead
  // of resetting to the saved values.
  const error = validateProductInput(input, instanceDomain());
  if (error) return { error, values: input };
  try {
    await updateMerchant(ownerId, product.id, input);
  } catch (err) {
    if (isUniqueConstraintError(err)) return { error: "Another product already uses that subdomain", values: input };
    throw err;
  }
  // The sidebar and the product switcher are rendered by the dashboard layout,
  // which a soft navigation reuses from cache.
  revalidatePath("/dashboard", "layout");
  redirect(settings(product.slug, "dns"));
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
  // A new key is the fix for a key that could not update the endpoint, so
  // the upgrade runs again now rather than leaving the light red until the
  // next start. It never throws.
  await upgradeMerchantWebhookEvents(product.id);
  redirect(settings(product.slug, "stripe"));
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
  // Same reason as the key: a recreated endpoint is the fix for a missing one.
  await upgradeMerchantWebhookEvents(product.id);
  redirect(settings(product.slug, "stripe"));
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
