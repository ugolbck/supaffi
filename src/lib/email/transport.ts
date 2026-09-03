import { Resend } from "resend";
import { decrypt } from "@/lib/crypto";

/**
 * How an email leaves the instance.
 *
 * Two independent questions, deliberately kept apart:
 *
 * 1. **Does this instance deliver at all?** Instance-level, `EMAIL_DELIVERY`.
 * 2. **Which provider does the delivering?** Per Merchant, from the Merchant
 *    record, because one instance hosts many Merchants (ADR 0006) and each
 *    brings their own credentials (CONTEXT.md).
 *
 * Collapsing those into one env value would mean an instance hosting one
 * Merchant on Resend and another on SMTP could not be described at all.
 *
 * `console` exists because Resend cannot deliver in development: mail is sent
 * from `affiliates@{merchant.domain}`, that domain is `localhost:3600`
 * locally, and nobody can verify localhost as a sender. See ADR 0008.
 */

export type MerchantForEmail = {
  name: string;
  domain: string;
  emailProviderConfigEnc: string | null;
};

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
};

export type DeliveryMode = "send" | "console";

/**
 * Read per call, not once at module load, so the value stays testable without
 * re-importing.
 *
 * Defaults to `send`, and nothing here reads `NODE_ENV`. Branching on the name
 * of an environment is what 12-factor warns against: it does not survive
 * staging, QA or a second developer's setup. Development opts in explicitly
 * through `.env.example`, so the unsafe direction is always the one someone
 * had to type.
 */
export function deliveryMode(): DeliveryMode {
  // Trimmed so a stray space in a `.env` behaves like the value it obviously
  // means, and so an empty assignment behaves like an absent one.
  const configured = process.env.EMAIL_DELIVERY?.trim();
  if (!configured) return "send";
  if (configured === "send" || configured === "console") return configured;
  // A typo would otherwise fall through to the default and look honoured.
  throw new Error(`Unknown EMAIL_DELIVERY: ${configured}. Use "send" or "console".`);
}

// Any absolute URL in the body. The point of the console mode is the magic
// link, and pulling it out generically means no email has to carry a second
// copy of its own link just to be printable.
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;

function printToConsole(merchant: MerchantForEmail, email: OutboundEmail): void {
  const links = email.html.match(URL_PATTERN) ?? [];
  const rule = "─".repeat(72);

  // Says NOT SENT on every single send, at warn rather than info: this is the
  // whole safety net now that there is no environment check to refuse console
  // mode in production, and aggregators routinely drop info.
  //
  // The printed links carry live single-use login tokens. That is the point in
  // development and the danger in production, where anyone who can read the
  // log can request a link for any affiliate and use it. See ADR 0008.
  console.warn(
    [
      rule,
      "  EMAIL NOT SENT (EMAIL_DELIVERY=console)",
      `  merchant: ${merchant.name} (${merchant.domain})`,
      `  to:       ${email.to}`,
      `  subject:  ${email.subject}`,
      ...(links.length ? ["  links:", ...links.map((link) => `    ${link}`)] : []),
      rule,
    ].join("\n")
  );
}

// Both halves of the From header are Merchant-controlled and neither is
// validated as header-safe at write time: `validateProductInput` only requires
// a non-empty name, and its domain check rejects slashes and whitespace but
// permits quotes, commas and angle brackets. Angle brackets and commas break
// out of the display name and add recipients; CR and LF end the header
// entirely and start a new one.
function headerSafe(value: string): string {
  return value.replace(/[<>,"\r\n]/g, "");
}

async function sendViaResend(
  merchant: MerchantForEmail,
  email: OutboundEmail,
  configEnc: string
): Promise<void> {
  const resend = new Resend(decrypt(configEnc));

  const { error } = await resend.emails.send({
    from: `${headerSafe(merchant.name)} Affiliates <affiliates@${headerSafe(merchant.domain)}>`,
    to: email.to,
    subject: headerSafe(email.subject),
    html: email.html,
  });

  // Resend's SDK does not reject on a refused send, it resolves with
  // `{ data: null, error }`. Unhandled, an unverified sending domain would
  // show the affiliate a "check your email" that will never arrive.
  if (error) {
    throw new Error(`Resend rejected the send: ${error.name}: ${error.message}`);
  }
}

/**
 * Hands the email to whichever provider this Merchant configured.
 *
 * Resend is the only one today, so there is nothing to branch on yet. SMTP
 * adds a stored provider on the Merchant and a branch here. Neither
 * `EMAIL_DELIVERY` nor anything a developer runs locally changes.
 */
async function deliver(merchant: MerchantForEmail, email: OutboundEmail): Promise<void> {
  const configEnc = merchant.emailProviderConfigEnc;
  if (!configEnc) {
    throw new Error("Email delivery is not connected for this Merchant");
  }
  await sendViaResend(merchant, email, configEnc);
}

export async function sendEmail(
  merchant: MerchantForEmail,
  email: OutboundEmail
): Promise<void> {
  if (deliveryMode() === "console") {
    printToConsole(merchant, email);
    return;
  }
  await deliver(merchant, email);
}
