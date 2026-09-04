"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createMerchant as createMerchantRecord } from "@/lib/merchant";
import { validateProductInput, normalizeDomain } from "./validation";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { instanceDomain } from "@/lib/instance";

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
  };

  const validationError = validateProductInput(input, instanceDomain());
  if (validationError) return { error: validationError };

  let slug: string;
  try {
    const created = await createMerchantRecord(session.user.id, {
      name: input.name.trim(),
      domain: normalizeDomain(input.domain),
      websiteUrl: input.websiteUrl.trim(),
    });
    slug = created.slug;
  } catch (err) {
    // Unique constraint on Merchant.domain — the most likely real-world
    // failure here, worth a specific message rather than a raw 500.
    // isUniqueConstraintError is the same helper the webhook route and
    // worker handlers already use for this exact check (src/lib/prismaErrors.ts)
    // — do not string-match err.message, that's fragile and inconsistent
    // with the rest of the codebase.
    if (isUniqueConstraintError(err)) {
      return { error: "That domain is already in use by another product" };
    }
    throw err;
  }

  // Straight into the next onboarding step rather than the product page:
  // a product with no payment provider connected cannot do anything yet.
  // The sidebar and breadcrumb are rendered by the dashboard layout, which a
  // soft navigation reuses from cache. Without this the product list, the
  // breadcrumb's name lookup and the setup checklist all keep showing the
  // state from before this action ran.
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/products/${slug}/integrations`);
}
