"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { updateAffiliate } from "@/lib/affiliate";
import { createAffiliateResetLink } from "@/lib/affiliatePassword";
import { addPromoCode, removePromoCode } from "@/lib/promoCode";

/**
 * The writes the affiliate sheet makes: which program someone is in, what
 * they are paid, their password link and their promo codes.
 */

async function owner(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  return session.user.id;
}

export async function changeProgramAction(
  product: { id: string; slug: string },
  affiliateId: string,
  formData: FormData
): Promise<void> {
  const ownerId = await owner();
  const programId = String(formData.get("programId") ?? "").trim();
  // An empty id is refused by updateAffiliate, and the select always carries a
  // real one, so nothing is left to do here but ignore a submit that does not.
  if (programId === "") return;
  await updateAffiliate(ownerId, product.id, affiliateId, { programId });
  revalidatePath(`/dashboard/products/${product.slug}/affiliates`);
}

export async function setCustomRateAction(
  product: { id: string; slug: string },
  affiliateId: string,
  formData: FormData
): Promise<void> {
  const ownerId = await owner();

  // "Use default" carries its own field. Reading an empty `rate` instead
  // would never fire: the button and the input share a form, and the value
  // already typed into the input is the one FormData hands back.
  if (formData.get("intent") === "default") {
    await updateAffiliate(ownerId, product.id, affiliateId, { customCommissionRate: null });
    revalidatePath(`/dashboard/products/${product.slug}/affiliates`);
    return;
  }

  const raw = String(formData.get("rate") ?? "").trim();
  if (raw === "") return;
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return;
  await updateAffiliate(ownerId, product.id, affiliateId, { customCommissionRate: rate });
  revalidatePath(`/dashboard/products/${product.slug}/affiliates`);
}

/**
 * A one-time link for this affiliate to set a password, for the Owner to send
 * them. Answers the token only; the sheet builds the URL on the product's
 * affiliate domain, where the link has to be opened.
 */
export async function createPasswordLinkAction(
  product: { id: string },
  affiliateId: string
): Promise<{ token: string } | { error: string }> {
  const ownerId = await owner();
  const token = await createAffiliateResetLink(ownerId, product.id, affiliateId);
  return token ? { token } : { error: "Affiliate not found" };
}

/** Gives the affiliate a Stripe promotion code, looked up by its text. */
export async function addPromoCodeAction(
  product: { id: string; slug: string },
  affiliateId: string,
  code: string
): Promise<{ error: string; keyLacksPermission?: true } | null> {
  const ownerId = await owner();
  const result = await addPromoCode(ownerId, product.id, affiliateId, code);
  if (!result.ok) return { error: result.error, keyLacksPermission: result.keyLacksPermission };
  revalidatePath(`/dashboard/products/${product.slug}/affiliates`);
  return null;
}

export async function removePromoCodeAction(
  product: { id: string; slug: string },
  affiliateId: string,
  promoCodeId: string
): Promise<void> {
  const ownerId = await owner();
  await removePromoCode(ownerId, product.id, affiliateId, promoCodeId);
  revalidatePath(`/dashboard/products/${product.slug}/affiliates`);
}
