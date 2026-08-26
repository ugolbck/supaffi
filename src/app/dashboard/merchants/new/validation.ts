export type MerchantInput = {
  name: string;
  domain: string;
  websiteUrl: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  emailProviderConfig: string;
};

// Runtime domain lookups (webhooks, click tracking, Caddy's on-demand TLS
// ask) are all exact-string matches against a real Host header/SNI, which is
// always lowercase and never padded with whitespace. Normalizing here — and
// having callers store this normalized value, not the raw form input — is
// what keeps a stored Merchant.domain matchable by those lookups.
export function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase();
}

function isValidWebsiteUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateMerchantInput(input: MerchantInput): string | null {
  if (!input.name.trim()) return "Name is required";

  const domain = normalizeDomain(input.domain);
  if (!domain) return "Domain is required";
  if (domain.includes("://") || domain.includes("/") || /\s/.test(domain)) {
    return "Domain must be a bare hostname (no https://, no path)";
  }

  if (!isValidWebsiteUrl(input.websiteUrl)) {
    return "Website URL must be a full address starting with http:// or https://";
  }

  if (!input.stripeSecretKey.startsWith("sk_")) return "Stripe secret key must start with sk_";
  if (!input.stripeWebhookSecret.startsWith("whsec_"))
    return "Stripe webhook signing secret must start with whsec_";
  if (!input.emailProviderConfig.trim()) return "Email provider configuration is required";

  return null;
}

// Blank credential fields mean "keep existing" on edit — unlike
// validateMerchantInput (create), where all three are required. Only
// validates non-blank credential fields; a blank one is always accepted here.
export function validateMerchantEditInput(input: MerchantInput): string | null {
  if (!input.name.trim()) return "Name is required";

  const domain = normalizeDomain(input.domain);
  if (!domain) return "Domain is required";
  if (domain.includes("://") || domain.includes("/") || /\s/.test(domain)) {
    return "Domain must be a bare hostname (no https://, no path)";
  }

  if (!isValidWebsiteUrl(input.websiteUrl)) {
    return "Website URL must be a full address starting with http:// or https://";
  }

  if (input.stripeSecretKey && !input.stripeSecretKey.startsWith("sk_")) {
    return "Stripe secret key must start with sk_";
  }
  if (input.stripeWebhookSecret && !input.stripeWebhookSecret.startsWith("whsec_")) {
    return "Stripe webhook signing secret must start with whsec_";
  }

  return null;
}
