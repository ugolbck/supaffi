"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createMerchant as createMerchantRecord } from "@/lib/merchant";
import { validateMerchantInput, normalizeDomain } from "./validation";
import { isUniqueConstraintError } from "@/lib/prismaErrors";

export async function createMerchantAction(
  // Required by useActionState's action contract even though this function
  // doesn't read it — it always derives the next state from scratch.
  _prevState: { error: string },
  formData: FormData
): Promise<{ error: string } | never> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const input = {
    name: String(formData.get("name") ?? ""),
    domain: String(formData.get("domain") ?? ""),
    websiteUrl: String(formData.get("websiteUrl") ?? ""),
    stripeSecretKey: String(formData.get("stripeSecretKey") ?? ""),
    stripeWebhookSecret: String(formData.get("stripeWebhookSecret") ?? ""),
    emailProviderConfig: String(formData.get("emailProviderConfig") ?? ""),
  };

  const validationError = validateMerchantInput(input);
  if (validationError) return { error: validationError };

  let merchantId: string;
  try {
    const created = await createMerchantRecord(session.user.id, {
      ...input,
      name: input.name.trim(),
      domain: normalizeDomain(input.domain),
      websiteUrl: input.websiteUrl.trim(),
    });
    merchantId = created.id;
  } catch (err) {
    // Unique constraint on Merchant.domain — the most likely real-world
    // failure here, worth a specific message rather than a raw 500.
    // isUniqueConstraintError is the same helper the webhook route and
    // worker handlers already use for this exact check (src/lib/prismaErrors.ts)
    // — do not string-match err.message, that's fragile and inconsistent
    // with the rest of the codebase.
    if (isUniqueConstraintError(err)) {
      return { error: "That domain is already in use by another Merchant" };
    }
    throw err;
  }

  redirect(`/dashboard/merchants/${merchantId}`);
}
