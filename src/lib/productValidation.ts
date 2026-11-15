import { isLocalDomain } from "@/lib/url";

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

/**
 * What an Owner types as their site, made into a full address. A bare
 * `pagecast.app` is what people write, so it gets `https://` rather than an
 * error; anything that already names a scheme is left for the check below.
 */
export function normalizeWebsiteUrl(raw: string): string {
  const value = raw.trim();
  if (!value || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return `https://${value}`;
}

// A public DNS name: two or more labels of letters, digits and inner hyphens,
// each at most 63 characters, with no port, no trailing dot, and a top level
// label that is not all digits, which rules out an IPv4 address. An IPv6
// address never matches, since it needs a colon or brackets.
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME = new RegExp(`^(?:${LABEL}\\.)+${LABEL}$`);

export function isPublicHostname(domain: string): boolean {
  if (domain.length > 253 || !HOSTNAME.test(domain)) return false;
  return !/^[0-9]+$/.test(domain.slice(domain.lastIndexOf(".") + 1));
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
  // A product is served on a public name. localhost and the like are allowed
  // outside production only, where a product shares the developer's machine.
  if (!isPublicHostname(domain) && !(process.env.NODE_ENV !== "production" && isLocalDomain(domain))) {
    return "Domain must be a full hostname, like affiliates.example.com";
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
