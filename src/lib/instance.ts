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
