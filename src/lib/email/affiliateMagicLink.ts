import { originFor } from "@/lib/url";
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
    html: `
      <p>Click the link below to log in. This link expires in 15 minutes and can only be used once.</p>
      <p><a href="${verifyUrl}">Log in to your affiliate dashboard</a></p>
    `,
  });
}
