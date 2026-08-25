"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { updateMerchant as updateMerchantRecord } from "@/lib/merchant";
import { validateMerchantEditInput, normalizeDomain } from "../../new/validation";
import { isUniqueConstraintError } from "@/lib/prismaErrors";

export async function updateMerchantAction(
  merchantId: string,
  _prevState: { error: string },
  formData: FormData
): Promise<{ error: string } | never> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const stripeSecretKey = String(formData.get("stripeSecretKey") ?? "");
  const stripeWebhookSecret = String(formData.get("stripeWebhookSecret") ?? "");
  const emailProviderConfig = String(formData.get("emailProviderConfig") ?? "");

  const input = {
    name: String(formData.get("name") ?? ""),
    domain: String(formData.get("domain") ?? ""),
    stripeSecretKey,
    stripeWebhookSecret,
    emailProviderConfig,
  };

  const validationError = validateMerchantEditInput(input);
  if (validationError) return { error: validationError };

  try {
    await updateMerchantRecord(session.user.id, merchantId, {
      name: input.name.trim(),
      domain: normalizeDomain(input.domain),
      // Blank means "keep existing" on edit — updateMerchant only
      // overwrites a credential field when it is !== undefined, so an
      // empty string here (not converted) would get encrypted and
      // silently wipe out the Merchant's live credential.
      stripeSecretKey: stripeSecretKey || undefined,
      stripeWebhookSecret: stripeWebhookSecret || undefined,
      emailProviderConfig: emailProviderConfig || undefined,
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return { error: "That domain is already in use by another Merchant" };
    }
    throw err;
  }

  redirect(`/dashboard/merchants/${merchantId}`);
}
