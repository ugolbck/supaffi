// Pure redirect-decision logic for src/middleware.ts, kept in its own module
// so it can be unit tested without importing next-auth (via @/lib/auth).
// Importing next-auth transitively imports "next/server", which Next.js's
// package.json does not expose via an "exports" map — Node's ESM resolver
// (used by Vitest) can't resolve that bare specifier outside of Next's own
// bundler, so any test that imports @/lib/auth fails at import time
// regardless of AUTH_SECRET. See src/middleware.ts for where this is used.

const PROTECTED_PREFIXES = ["/dashboard"];

export function shouldRedirectToLogin(pathname: string, hasSession: boolean): boolean {
  if (hasSession) return false;
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
