"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  getMerchantForOwner,
  getStripeWebhookEndpointId,
  updateMerchant,
  connectStripe,
  connectEmailProvider,
  markOnboardingComplete,
} from "@/lib/merchant";
import { validateProductInput, normalizeDomain } from "@/lib/productValidation";
import { instanceDomain } from "@/lib/instance";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { stepPath, nextStep, splitSubdomain, rehomeSubdomain, type StepId } from "@/lib/onboarding";
import { deliveryMode } from "@/lib/email/transport";
import { createProgram, updateProgram, listProgramsForMerchant } from "@/lib/program";
import { validateProgramInput } from "@/lib/programValidation";
import { stripeKeyWorks } from "@/lib/checks/stripe";
import { createWebhookEndpoint } from "@/lib/stripeWebhookEndpoint";
import { webhookEndpointUrl } from "@/lib/stripeWebhookLink";
import { isLocalDomain } from "@/lib/url";
import { resendKeyWorks } from "@/lib/checks/email";

/** Whether this instance has the two email steps at all. */
function setupEmailRequired(): boolean {
  return deliveryMode() === "send";
}

async function owner(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  return session.user.id;
}

/**
 * `savedAt` is what closes the inline editor and shows the confirmation. It
 * changes on every successful write, so saving the same value twice still
 * confirms rather than looking like nothing happened.
 */
export type EditResult = { error: string; savedAt?: number };

export async function updateSubdomainAction(
  product: { id: string; slug: string },
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  const ownerId = await owner();
  const merchant = await getMerchantForOwner(ownerId, product.id);
  if (!merchant) redirect("/onboarding");

  // The field only edits the label in front of the root when the stored
  // address sits under the product's own site. Where it does not — a local
  // instance, or an address set by hand — the whole thing is edited.
  const split = splitSubdomain(merchant.domain, merchant.websiteUrl);
  const raw = String(formData.get("value") ?? "").trim();
  if (!raw) return { error: "This cannot be empty" };
  if (split && !/^[a-z0-9-]+$/i.test(raw)) {
    return { error: "Letters, numbers and dashes only" };
  }
  const domain = normalizeDomain(split ? `${raw}${split.suffix}` : raw);

  const error = validateProductInput({ name: merchant.name, domain, websiteUrl: merchant.websiteUrl }, instanceDomain());
  if (error) return { error };

  try {
    await updateMerchant(ownerId, product.id, { name: merchant.name, domain, websiteUrl: merchant.websiteUrl });
  } catch (err) {
    if (isUniqueConstraintError(err)) return { error: "Another product already uses that address" };
    throw err;
  }
  revalidatePath(stepPath(product.slug, "subdomain"));
  return { error: "", savedAt: Date.now() };
}

export async function updateProductNameAction(
  product: { id: string; slug: string },
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  const ownerId = await owner();
  const merchant = await getMerchantForOwner(ownerId, product.id);
  if (!merchant) redirect("/onboarding");

  const name = String(formData.get("value") ?? "").trim();
  const error = validateProductInput({ name, domain: merchant.domain, websiteUrl: merchant.websiteUrl }, instanceDomain());
  if (error) return { error };

  await updateMerchant(ownerId, product.id, { name, domain: merchant.domain, websiteUrl: merchant.websiteUrl });
  revalidatePath(stepPath(product.slug, "product"));
  return { error: "", savedAt: Date.now() };
}

/**
 * Correcting the website moves the program's address with it, keeping any
 * label the owner chose. Someone who typed the wrong site during setup was
 * previously stuck with it: the product step redirected away from itself, so
 * there was no screen left that could fix this.
 */
export async function updateProductWebsiteAction(
  product: { id: string; slug: string },
  _prev: EditResult,
  formData: FormData
): Promise<EditResult> {
  const ownerId = await owner();
  const merchant = await getMerchantForOwner(ownerId, product.id);
  if (!merchant) redirect("/onboarding");

  const websiteUrl = String(formData.get("value") ?? "").trim();
  const domain = normalizeDomain(rehomeSubdomain(merchant.domain, merchant.websiteUrl, websiteUrl));
  const error = validateProductInput({ name: merchant.name, domain, websiteUrl }, instanceDomain());
  if (error) return { error };

  try {
    await updateMerchant(ownerId, product.id, { name: merchant.name, domain, websiteUrl });
  } catch (err) {
    if (isUniqueConstraintError(err)) return { error: "Another product already uses that address" };
    throw err;
  }
  revalidatePath(stepPath(product.slug, "product"));
  revalidatePath(stepPath(product.slug, "subdomain"));
  return { error: "", savedAt: Date.now() };
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

  // With write access on webhook endpoints, Supaffi sets its own endpoint up
  // and the owner never sees Stripe's three-step wizard. Without it, or on a
  // local instance Stripe cannot reach, the webhook step is still there and
  // explains the manual path. Either way a failure here is not fatal: the key
  // is already stored and the next step can finish the job.
  const merchant = await getMerchantForOwner(ownerId, product.id);
  const existingEndpoint = merchant ? await getStripeWebhookEndpointId(ownerId, product.id) : null;
  if (merchant && !isLocalDomain(merchant.domain) && !existingEndpoint) {
    const created = await createWebhookEndpoint({
      secretKey: key,
      url: webhookEndpointUrl(merchant.domain),
      productName: merchant.name,
    });
    if (created.ok) {
      await connectStripe(ownerId, product.id, {
        webhookSecret: created.secret,
        webhookEndpointId: created.id,
      });
      // Nothing left for the owner to do about webhooks, so the step that
      // would have asked them is skipped outright.
      redirect(stepPath(product.slug, nextStep("stripe-webhook", setupEmailRequired())!));
    }
  }
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
  // A hand-pasted secret belongs to an endpoint Supaffi did not create, so
  // the stored endpoint id is cleared: it must never later delete something
  // the owner made themselves.
  await connectStripe(ownerId, product.id, { webhookSecret: secret, webhookEndpointId: null });
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
  // Not a hardcoded "email-domain": that was only ever true while the key
  // came before the domain in the step order, and now it comes after.
  redirect(stepPath(product.slug, nextStep("email-key", setupEmailRequired())!));
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

/**
 * "Check now": re-runs the step's own section instead of waiting for the
 * next 15 second tick. The section a step names is already run fresh on
 * every render (`checks.ts`), so revalidating the step's own path is enough;
 * there is no separate cache to invalidate here.
 */
export async function recheckAction(product: { id: string; slug: string }, step: StepId): Promise<void> {
  await owner();
  revalidatePath(stepPath(product.slug, step));
}

export async function finishOnboardingAction(product: { id: string; slug: string }): Promise<void> {
  const ownerId = await owner();
  await markOnboardingComplete(ownerId, product.id);
  revalidatePath("/dashboard", "layout");
  // Back to the step they were already on, which now renders the finished
  // modal over itself.
  revalidatePath(stepPath(product.slug, "tracking"));
  redirect(stepPath(product.slug, "tracking"));
}
