export type MerchantInput = {
  name: string;
  domain: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  emailProviderConfig: string;
};

export function validateMerchantInput(input: MerchantInput): string | null {
  if (!input.name.trim()) return "Name is required";

  const domain = input.domain.trim();
  if (!domain) return "Domain is required";
  if (domain.includes("://") || domain.includes("/") || /\s/.test(domain)) {
    return "Domain must be a bare hostname (no https://, no path)";
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

  const domain = input.domain.trim();
  if (!domain) return "Domain is required";
  if (domain.includes("://") || domain.includes("/") || /\s/.test(domain)) {
    return "Domain must be a bare hostname (no https://, no path)";
  }

  if (input.stripeSecretKey && !input.stripeSecretKey.startsWith("sk_")) {
    return "Stripe secret key must start with sk_";
  }
  if (input.stripeWebhookSecret && !input.stripeWebhookSecret.startsWith("whsec_")) {
    return "Stripe webhook signing secret must start with whsec_";
  }

  return null;
}
