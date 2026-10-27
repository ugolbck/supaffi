import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeClientFor } from "@/lib/stripe";
import { isUniqueConstraintError } from "@/lib/prismaErrors";

/**
 * Stripe promotion codes the Owner gives an Affiliate.
 *
 * A Checkout Session names the code it used only by Stripe's id
 * (`discounts[].promotion_code`, "Promotion code attached to the Checkout
 * Session", Stripe docs, api/checkout/sessions/object), never by the text the
 * customer typed. So the text is turned into that id here, once, when the
 * Owner adds it, and every sale after that is matched on the id with no
 * further Stripe call. That one lookup is the only thing that needs the
 * Promotion Codes permission: `GET /v1/promotion_codes` requires
 * `promotion_code_read` (Stripe docs, keys/permissions-reference.md).
 */

export const MAX_PROMO_CODES_PER_AFFILIATE = 20;
// Far longer than any code Stripe would hold; only stops an absurd paste
// from reaching the Stripe request.
const MAX_CODE_LENGTH = 200;

export type PromoCodeRow = { id: string; code: string };

/** `keyLacksPermission` sends the Owner to replace the key, from the form. */
export type AddPromoCodeResult = { ok: true } | { ok: false; error: string; keyLacksPermission?: true };

type Lookup =
  | { found: Stripe.PromotionCode }
  | { error: string; keyLacksPermission?: true };

/**
 * The one active promotion code with this text. `code` "Only return promotion
 * codes that have this case-insensitive code" (Stripe docs,
 * api/promotion_codes/list.md). Codes limited to different customers may share
 * the same text, and then there is no telling which one the Owner means, so
 * more than one match is refused rather than guessed.
 */
async function lookUp(stripe: Stripe, code: string): Promise<Lookup> {
  let list: Stripe.ApiList<Stripe.PromotionCode>;
  try {
    list = await stripe.promotionCodes.list({ code, active: true, limit: 2 });
  } catch (err) {
    const error = err as Stripe.errors.StripeError;
    // A key without the permission. Stripe documents it as an invalid
    // request error for restricted keys (keys/restricted-api-keys.md), and a
    // list filtered on nothing but a code has no other way to be invalid.
    if (
      error?.type === "StripePermissionError" ||
      error?.type === "StripeInvalidRequestError" ||
      error?.type === "StripeAuthenticationError" ||
      error?.statusCode === 401 ||
      error?.statusCode === 403
    ) {
      return { error: "Your Stripe key can't read promotion codes.", keyLacksPermission: true };
    }
    return { error: "Stripe could not be reached. Try again." };
  }
  if (list.data.length === 0) return { error: "No active promotion code with that text in Stripe" };
  if (list.data.length > 1) return { error: "More than one promotion code in Stripe uses that text" };
  return { found: list.data[0] };
}

async function ownedAffiliate(ownerId: string, merchantId: string, affiliateId: string) {
  return db.affiliate.findFirst({
    where: { id: affiliateId, merchantId, merchant: { ownerId } },
    select: { id: true, merchant: { select: { id: true, stripeSecretKeyEnc: true } } },
  });
}

export async function addPromoCode(
  ownerId: string,
  merchantId: string,
  affiliateId: string,
  rawCode: string
): Promise<AddPromoCodeResult> {
  const code = rawCode.trim();
  if (code === "") return { ok: false, error: "Enter a code" };
  if (code.length > MAX_CODE_LENGTH) return { ok: false, error: "That code is too long" };

  const affiliate = await ownedAffiliate(ownerId, merchantId, affiliateId);
  if (!affiliate) return { ok: false, error: "Affiliate not found" };
  if (!affiliate.merchant.stripeSecretKeyEnc) return { ok: false, error: "Connect Stripe first" };

  const count = await db.affiliatePromoCode.count({ where: { affiliateId } });
  if (count >= MAX_PROMO_CODES_PER_AFFILIATE) {
    return { ok: false, error: `An affiliate can have up to ${MAX_PROMO_CODES_PER_AFFILIATE} codes` };
  }

  const lookup = await lookUp(stripeClientFor(affiliate.merchant), code);
  if ("error" in lookup) return { ok: false, ...lookup };

  try {
    await db.affiliatePromoCode.create({
      data: {
        merchantId,
        affiliateId,
        stripePromotionCodeId: lookup.found.id,
        code: lookup.found.code,
      },
    });
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    return { ok: false, error: "That code already belongs to an affiliate" };
  }
  return { ok: true };
}

/**
 * Takes a code away. Checkouts that use it from now on credit nobody through
 * it; the subscriptions it already brought keep earning, because they belong
 * to the click that sale recorded, not to the code.
 */
export async function removePromoCode(
  ownerId: string,
  merchantId: string,
  affiliateId: string,
  promoCodeId: string
): Promise<void> {
  const affiliate = await ownedAffiliate(ownerId, merchantId, affiliateId);
  if (!affiliate) throw new Error("Affiliate not found");
  await db.affiliatePromoCode.deleteMany({ where: { id: promoCodeId, affiliateId, merchantId } });
}

export async function listPromoCodes(affiliateId: string): Promise<PromoCodeRow[]> {
  return db.affiliatePromoCode.findMany({
    where: { affiliateId },
    select: { id: true, code: true },
    orderBy: { createdAt: "asc" },
  });
}
