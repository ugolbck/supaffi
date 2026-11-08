// The bare hostname this Instance's admin dashboard and setup wizard are
// served on, set once at install time. Deliberately not a Merchant domain:
// Caddy gives this one an ordinary certificate from a named site block, so it
// resolves on a box whose database is still empty. Merchant domains are
// issued on demand and gated by /api/internal/domain-check, which cannot
// approve anything before setup has run (ADR 0006).
//
// Normalized the same way Merchant.domain is, and for the same reason: every
// runtime comparison is against a real Host header, which arrives lowercase
// and unpadded.
export function instanceDomain(): string {
  return (process.env.SUPAFFI_DOMAIN ?? "").trim().toLowerCase();
}

/**
 * Where an Owner opens their dashboard from outside it, for links in emails.
 * The domain when there is one, since that is the address somebody chose;
 * otherwise the IP and port the installer serves it on. Null when neither is
 * set, as on a developer's machine, and the email goes without a button.
 */
export function dashboardOrigin(): string | null {
  const domain = instanceDomain();
  if (domain) return `https://${domain}`;
  const hostIp = process.env.SUPAFFI_HOST_IP?.trim();
  if (!hostIp) return null;
  return `https://${hostIp}:${process.env.SUPAFFI_DASHBOARD_PORT?.trim() || "3443"}`;
}
