"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  getMerchantForOwner,
  updateMerchant,
  connectStripe,
  connectEmailProvider,
  markOnboardingComplete,
} from "@/lib/merchant";
import { validateProductInput, normalizeDomain } from "@/app/dashboard/products/new/validation";
import { instanceDomain } from "@/lib/instance";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { stepPath } from "@/lib/onboarding";
import { createProgram, updateProgram, listProgramsForMerchant } from "@/lib/program";
import { validateProgramInput } from "@/lib/programValidation";
import { stripeKeyWorks } from "@/lib/checks/stripe";
import { resendKeyWorks } from "@/lib/checks/email";

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

export async function saveStripeKeyAction(
  product: { id: string; slug: string },
  _prev: { error: string },
  formData: FormData
): Promise<{ error: string }> {
  const ownerId = await owner();
  const key = String(formData.get("value") ?? "").trim();
  // Checked before it is stored: a key that fails here fails on the screen
  // that can fix it, not on the first sale weeks later.
  const check = await stripeKeyWorks(key);
  if (!check.ok) return { error: check.detail };
  await connectStripe(ownerId, product.id, { secretKey: key });
  redirect(stepPath(product.slug, "stripe-webhook"));
}

export async function saveWebhookSecretAction(
  product: { id: string; slug: string },
  _prev: { error: string },
  formData: FormData
): Promise<{ error: string }> {
  const ownerId = await owner();
  const secret = String(formData.get("value") ?? "").trim();
  if (!secret.startsWith("whsec_")) return { error: "The signing secret starts with whsec_" };
  await connectStripe(ownerId, product.id, { webhookSecret: secret });
  revalidatePath(stepPath(product.slug, "stripe-webhook"));
  return { error: "" };
}

export async function saveEmailKeyAction(
  product: { id: string; slug: string },
  _prev: { error: string },
  formData: FormData
): Promise<{ error: string }> {
  const ownerId = await owner();
  const key = String(formData.get("value") ?? "").trim();
  const check = await resendKeyWorks(key);
  if (!check.ok) return { error: check.detail };
  await connectEmailProvider(ownerId, product.id, key);
  redirect(stepPath(product.slug, "email-domain"));
}

export async function saveTermsAction(
  product: { id: string; slug: string },
  _prev: { error: string },
  formData: FormData
): Promise<{ error: string }> {
  const ownerId = await owner();
  const result = validateProgramInput({
    name: String(formData.get("name") ?? ""),
    defaultCommissionRate: String(formData.get("defaultCommissionRate") ?? ""),
    commissionDurationType: String(formData.get("commissionDurationType") ?? ""),
    commissionDurationMonths: String(formData.get("commissionDurationMonths") ?? ""),
    attributionWindowDays: String(formData.get("attributionWindowDays") ?? ""),
    holdingPeriodDays: String(formData.get("holdingPeriodDays") ?? ""),
  });
  if (result.error !== null) return { error: result.error };

  // The onboarding step edits the first program if one exists rather than
  // adding a second, so going back and changing a number does not leave a
  // trail of near identical programs.
  const existing = await listProgramsForMerchant(ownerId, product.id);
  if (existing.length > 0) {
    await updateProgram(ownerId, product.id, existing[0].id, result.parsed);
  } else {
    await createProgram(ownerId, product.id, result.parsed);
  }
  redirect(stepPath(product.slug, "tracking"));
}

export async function finishOnboardingAction(product: { id: string; slug: string }): Promise<void> {
  const ownerId = await owner();
  await markOnboardingComplete(ownerId, product.id);
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/products/${product.slug}`);
}
