"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createMerchant } from "@/lib/merchant";
import { validateProductInput, normalizeDomain } from "@/app/dashboard/products/new/validation";
import { instanceDomain } from "@/lib/instance";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { suggestSubdomain, stepPath } from "@/lib/onboarding";

export async function createProductAction(
  _prev: { error: string },
  formData: FormData
): Promise<{ error: string }> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  const websiteUrl = String(formData.get("websiteUrl") ?? "").trim();
  const domain = suggestSubdomain(websiteUrl);
  // Nothing readable came out of the address, so there is no subdomain to
  // validate. Say what is actually wrong instead of complaining about a
  // field the form never showed.
  if (!domain) return { error: "Enter the full website address, starting with https://" };

  const error = validateProductInput({ name, domain, websiteUrl }, instanceDomain());
  if (error) return { error };

  let slug: string;
  try {
    slug = (await createMerchant(session.user.id, { name, domain: normalizeDomain(domain), websiteUrl })).slug;
  } catch (err) {
    if (isUniqueConstraintError(err)) return { error: "A product on that site already exists" };
    throw err;
  }
  redirect(stepPath(slug, "subdomain"));
}
