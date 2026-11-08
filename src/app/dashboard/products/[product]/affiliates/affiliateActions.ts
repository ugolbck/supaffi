"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { updateAffiliate } from "@/lib/affiliate";
import { createAffiliateResetLink } from "@/lib/affiliatePassword";
import { db } from "@/lib/db";
import { emailPasswordLink, OWNER_SENT_LINK_TTL_MS } from "@/lib/notify";
import { addPromoCode, issuePromoCode, turnOffPromoCode, type PromoCodeResult } from "@/lib/promoCode";

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

/** Emails the affiliate a password link from the owner's own mail server. */
export async function emailPasswordLinkAction(
  product: { id: string },
  affiliateId: string
): Promise<{ sentTo: string } | { error: string }> {
  const ownerId = await owner();
  const affiliate = await db.affiliate.findFirst({
    where: { id: affiliateId, merchantId: product.id, merchant: { ownerId } },
    select: { id: true, email: true },
  });
  if (!affiliate) return { error: "Affiliate not found" };
  if (!(await emailPasswordLink(affiliate.id, OWNER_SENT_LINK_TTL_MS))) return { error: "Email is off" };
  return { sentTo: affiliate.email };
}

/** Gives the affiliate a Stripe promotion code, looked up by its text. */
export type PromoCodeActionError = { error: string; keyLacksPermission?: true } | null;

async function promoCodeWrite(
  product: { id: string; slug: string },
  write: (ownerId: string) => Promise<PromoCodeResult>
): Promise<PromoCodeActionError> {
  const result = await write(await owner());
  if (!result.ok) return { error: result.error, keyLacksPermission: result.keyLacksPermission };
  revalidatePath(`/dashboard/products/${product.slug}/affiliates`);
  return null;
}

/** Links a code that already exists in Stripe. */
export async function addPromoCodeAction(
  product: { id: string; slug: string },
  affiliateId: string,
  code: string
): Promise<PromoCodeActionError> {
  return promoCodeWrite(product, (ownerId) => addPromoCode(ownerId, product.id, affiliateId, code));
}

/** Creates the affiliate's code in Stripe from their program's coupon. */
export async function issuePromoCodeAction(
  product: { id: string; slug: string },
  affiliateId: string,
  code: string
): Promise<PromoCodeActionError> {
  return promoCodeWrite(product, (ownerId) => issuePromoCode(ownerId, product.id, affiliateId, code));
}

export async function turnOffPromoCodeAction(
  product: { id: string; slug: string },
  affiliateId: string,
  promoCodeId: string
): Promise<PromoCodeActionError> {
  return promoCodeWrite(product, (ownerId) => turnOffPromoCode(ownerId, product.id, affiliateId, promoCodeId));
}
