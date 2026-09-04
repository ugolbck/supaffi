export type ProductInput = {
  name: string;
  domain: string;
  websiteUrl: string;
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

// Create and edit validate exactly the same thing now: a Merchant is only
// ever its own details. Integrations are connected separately and validated
// by their own functions below.
//
// `instanceDomain` defaults to "" so the check is opt-in: local development
// and the existing unit tests call this with one argument, and there is no
// Instance domain to collide with there. Both real callers (create and edit)
// pass instanceDomain() from @/lib/instance.
export function validateProductInput(
  input: ProductInput,
  instanceDomain = ""
): string | null {
  if (!input.name.trim()) return "Name is required";

  const domain = normalizeDomain(input.domain);
  if (!domain) return "Domain is required";
  if (domain.includes("://") || domain.includes("/") || /\s/.test(domain)) {
    return "Domain must be a bare hostname (no https://, no path)";
  }
  // A Merchant on this domain would be served by the named Caddy site block
  // that exists to serve the admin dashboard, taking over the Owner's own
  // login. Enforced here rather than in each action because create and edit
  // share this validator.
  if (instanceDomain && domain === instanceDomain) {
    return "That domain serves this Supaffi instance.";
  }

  if (!isValidWebsiteUrl(input.websiteUrl)) {
    return "Website URL must be a full address starting with http:// or https://";
  }

  return null;
}

export type StripeCredentialsInput = {
  secretKey: string;
  webhookSecret: string;
};

// `allowBlank` is how "leave it alone" works when re-editing an already
// connected integration: a blank field keeps the stored secret rather than
// encrypting an empty string over the top of a live credential.
export function validateStripeCredentials(
  input: StripeCredentialsInput,
  allowBlank = false
): string | null {
  // `rk_` is the restricted key the connect screen's one-click link creates,
  // and the one an Owner should prefer: it carries read access to five
  // resources and nothing else. `sk_` stays accepted because an account that
  // predates that link already pasted one.
  if (
    !(allowBlank && !input.secretKey) &&
    !(input.secretKey.startsWith("sk_") || input.secretKey.startsWith("rk_"))
  ) {
    return "Stripe key must start with rk_ or sk_";
  }
  if (!(allowBlank && !input.webhookSecret) && !input.webhookSecret.startsWith("whsec_")) {
    return "Stripe webhook signing secret must start with whsec_";
  }
  return null;
}

export function validateEmailProviderKey(key: string, allowBlank = false): string | null {
  if (allowBlank && !key.trim()) return null;
  if (!key.trim()) return "Resend API key is required";
  return null;
}
