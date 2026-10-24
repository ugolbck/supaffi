"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { getMerchantByDomain } from "@/lib/merchant";
import { affiliatePasswordError, redeemAffiliateResetLink } from "@/lib/affiliatePassword";
import { ConcurrencyLimitError } from "@/lib/password";

const INVALID_LINK = "This link has expired or was already used. Ask for a new one.";

export async function setAffiliatePassword(
  token: string,
  _prevState: { error: string },
  formData: FormData
): Promise<{ error: string }> {
  const password = String(formData.get("password") ?? "");
  const passwordError = affiliatePasswordError(password);
  if (passwordError) return { error: passwordError };

  const host = (await headers()).get("host");
  const merchant = host ? await getMerchantByDomain(host) : null;
  if (!merchant) return { error: INVALID_LINK };

  let redeemed: { email: string } | null;
  try {
    redeemed = await redeemAffiliateResetLink(token, merchant.id, password);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) return { error: "Busy right now. Try again in a moment." };
    throw err;
  }
  if (!redeemed) return { error: INVALID_LINK };

  try {
    await signIn("affiliate-password", { email: redeemed.email, password, redirectTo: "/affiliates/dashboard" });
  } catch (err) {
    if (err instanceof AuthError) return { error: "Password saved. Log in to continue." };
    throw err; // Auth.js throws a redirect internally on success, must re-throw
  }
  return { error: "" };
}
