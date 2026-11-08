"use server";

import { headers } from "next/headers";
import { getMerchantByDomain } from "@/lib/merchant";
import { findAffiliateForLogin } from "@/lib/affiliatePassword";
import { emailPasswordLink, SELF_SERVE_LINK_TTL_MS } from "@/lib/notify";
import { reservePasswordLink } from "@/lib/passwordLinkThrottle";
import { clientAddress } from "@/lib/clientAddress";

/**
 * Emails a password link to an Affiliate who asks for one. The answer is the
 * same whether or not the email has an account here, and whether or not the
 * throttle let it through, so the form cannot be used to find out who is an
 * affiliate.
 */
export async function requestPasswordLink(_prev: { sentTo: string }, formData: FormData): Promise<{ sentTo: string }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  if (!email) return { sentTo: "" };

  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const merchant = host ? await getMerchantByDomain(host) : null;
  if (merchant && reservePasswordLink(merchant.id, email, clientAddress(new Headers(requestHeaders)))) {
    const affiliate = await findAffiliateForLogin(merchant.id, email);
    if (affiliate) await emailPasswordLink(affiliate.id, SELF_SERVE_LINK_TTL_MS);
  }
  return { sentTo: email };
}
