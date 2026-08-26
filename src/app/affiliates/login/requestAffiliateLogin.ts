"use server";

import { headers } from "next/headers";
import { getMerchantByDomain, getMerchantEmailCredentials } from "@/lib/merchant";
import { getAffiliateByEmail } from "@/lib/affiliate";
import { createAffiliateLoginToken } from "@/lib/affiliateAuth";
import { sendAffiliateMagicLinkEmail } from "@/lib/email/affiliateMagicLink";

type FormState = { status: "form" | "sent" };

export async function requestAffiliateLogin(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const host = (await headers()).get("host");

  if (email && host) {
    const merchant = await getMerchantByDomain(host);
    if (merchant) {
      const affiliate = await getAffiliateByEmail(merchant.id, email);
      if (affiliate) {
        const rawToken = await createAffiliateLoginToken(affiliate.id);
        const credentials = await getMerchantEmailCredentials(merchant.id);
        if (credentials) {
          await sendAffiliateMagicLinkEmail(credentials, affiliate, rawToken);
        }
      }
    }
  }

  // Always the same response, whether or not an account was found — avoids
  // confirming/denying account existence to an anonymous requester.
  return { status: "sent" };
}
