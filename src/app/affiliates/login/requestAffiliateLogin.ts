"use server";

import { headers } from "next/headers";
import { getMerchantByDomain, getMerchantEmailCredentials } from "@/lib/merchant";
import { getAffiliateByEmail } from "@/lib/affiliate";
import { createAffiliateLoginToken } from "@/lib/affiliateAuth";
import { sendAffiliateMagicLinkEmail } from "@/lib/email/affiliateMagicLink";
import { reserveAffiliateEmail } from "@/lib/affiliateEmailThrottle";
import { clientAddress } from "@/lib/clientAddress";

type FormState = { status: "form" | "sent" };

export async function requestAffiliateLogin(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");

  if (email && host) {
    const merchant = await getMerchantByDomain(host);
    // Counted whether or not the Affiliate exists, so the limit behaves the
    // same for every address and says nothing about which ones are real.
    const address = clientAddress(new Headers(requestHeaders));
    if (merchant && reserveAffiliateEmail(merchant.id, email, address)) {
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

  // Always the same response, whether or not an account was found and
  // whether or not the throttle let the email through. Avoids confirming or
  // denying account existence to an anonymous requester.
  return { status: "sent" };
}
