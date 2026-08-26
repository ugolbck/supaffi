// Pure redirect-decision logic for src/middleware.ts, kept in its own module
// so it can be unit tested without importing next-auth (via @/lib/auth).
// Importing next-auth transitively imports "next/server", which Next.js's
// package.json does not expose via an "exports" map — Node's ESM resolver
// (used by Vitest) can't resolve that bare specifier outside of Next's own
// bundler, so any test that imports @/lib/auth fails at import time
// regardless of AUTH_SECRET. See src/middleware.ts for where this is used.

type SessionRole = "owner" | "affiliate" | null;

const PROTECTED_ROUTES: ReadonlyArray<{
  prefix: string;
  role: "owner" | "affiliate";
  loginPath: string;
}> = [
  { prefix: "/dashboard", role: "owner", loginPath: "/login" },
  { prefix: "/affiliates/dashboard", role: "affiliate", loginPath: "/affiliates/login" },
];

// Returns the path to redirect to, or null if the request may proceed.
// A mismatched role (e.g. an Owner session hitting /affiliates/dashboard)
// redirects the same as no session at all — one shared session cookie
// means a session always exists for *some* role, and that's not enough.
export function resolveLoginRedirect(pathname: string, role: SessionRole): string | null {
  for (const route of PROTECTED_ROUTES) {
    if (pathname.startsWith(route.prefix) && role !== route.role) {
      return route.loginPath;
    }
  }
  return null;
}
