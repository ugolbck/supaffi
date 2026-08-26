import { Resend } from "resend";
import { decrypt } from "@/lib/crypto";

type MerchantForEmail = { name: string; domain: string; emailProviderConfigEnc: string };
type AffiliateForEmail = { email: string };

// Sends from the Merchant's own domain via the Merchant's own decrypted
// Resend key — never a platform-wide key (CONTEXT.md: the Merchant
// supplies their own email-sending credentials). This assumes the
// Merchant has verified `merchant.domain` as a sending domain in their own
// Resend account; if they haven't, Resend will reject the send and the
// caller sees that error surface (not swallowed here).
export async function sendAffiliateMagicLinkEmail(
  merchant: MerchantForEmail,
  affiliate: AffiliateForEmail,
  rawToken: string
): Promise<void> {
  const apiKey = decrypt(merchant.emailProviderConfigEnc);
  const resend = new Resend(apiKey);
  const verifyUrl = `https://${merchant.domain}/affiliates/verify?token=${encodeURIComponent(rawToken)}`;

  await resend.emails.send({
    from: `${merchant.name} Affiliates <affiliates@${merchant.domain}>`,
    to: affiliate.email,
    subject: `Log in to ${merchant.name}'s affiliate program`,
    html: `
      <p>Click the link below to log in. This link expires in 15 minutes and can only be used once.</p>
      <p><a href="${verifyUrl}">Log in to your affiliate dashboard</a></p>
    `,
  });
}
