import { originFor } from "@/lib/url";
import { emailShell } from "@/components/email/shell";
import { sendEmail, type MerchantForEmail } from "./transport";

type AffiliateForEmail = { email: string };

// What the email says. How it leaves the instance is `transport.ts`: in
// production the Merchant's own Resend key sending from the Merchant's own
// domain (never a platform-wide key, per CONTEXT.md), in development the
// terminal.
export async function sendAffiliateMagicLinkEmail(
  merchant: MerchantForEmail,
  affiliate: AffiliateForEmail,
  rawToken: string
): Promise<void> {
  const verifyUrl = `${originFor(merchant.domain)}/affiliates/verify?token=${encodeURIComponent(rawToken)}`;

  await sendEmail(merchant, {
    to: affiliate.email,
    subject: `Log in to ${merchant.name}'s affiliate program`,
    html: emailShell({
      merchantName: merchant.name,
      heading: "Log in to your affiliate account",
      body: "This link expires in 15 minutes and can only be used once.",
      action: { label: "Log in", href: verifyUrl },
    }),
  });
}
