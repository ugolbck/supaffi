// Pure redirect-decision logic for src/proxy.ts, kept in its own module
// so it can be unit tested without importing next-auth (via @/lib/auth).
// Importing next-auth transitively imports "next/server", which Next.js's
// package.json does not expose via an "exports" map — Node's ESM resolver
// (used by Vitest) can't resolve that bare specifier outside of Next's own
// bundler, so any test that imports @/lib/auth fails at import time
// regardless of AUTH_SECRET. See src/proxy.ts for where this is used.

import { staticExt } from "@/extensions/static";

type SessionRole = "owner" | "affiliate" | null;

const PROTECTED_ROUTES: ReadonlyArray<{
  prefix: string;
  role: "owner" | "affiliate";
  loginPath: string;
}> = [
  { prefix: "/dashboard", role: "owner", loginPath: "/login" },
  { prefix: "/affiliates/dashboard", role: "affiliate", loginPath: "/affiliates/login" },
  { prefix: "/onboarding", role: "owner", loginPath: "/login" },
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

// The Owner's pages, which belong on the dashboard address only. A product's
// affiliate domain serves its affiliates, so these answer not found there:
// otherwise an affiliate could land on the Owner's login under the product's
// name. The Owner signup and password reset pages, when there are any, are
// among them.
const OWNER_PREFIXES = ["/login", "/dashboard", "/onboarding", "/setup"];

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isOwnerPath(pathname: string): boolean {
  const { signupPath, passwordResetPath } = staticExt.owners;
  return [...OWNER_PREFIXES, signupPath, passwordResetPath].some((prefix) => prefix !== null && underPrefix(pathname, prefix));
}

// The paths whose answer depends on the session. The proxy's matcher has to
// be a constant, so it covers every page and reads the session for these only,
// which keeps every other page exactly as it was before the proxy saw it.
const SESSION_PREFIXES = [...OWNER_PREFIXES, "/affiliates/dashboard"];

export function proxyReadsSession(pathname: string): boolean {
  return pathname === "/" || SESSION_PREFIXES.some((prefix) => underPrefix(pathname, prefix));
}

/**
 * What a request on a product's affiliate domain gets instead of the page it
 * asked for, or null when the page is fine there. The root is where a
 * product's site sends would-be partners, so it goes to the program's entry
 * page, which signs them up; an affiliate already logged in goes straight to
 * their dashboard.
 */
export function resolveProductDomainRoute(
  pathname: string,
  role: SessionRole = null
): { redirect: string } | { notFound: true } | null {
  if (pathname === "/") return { redirect: role === "affiliate" ? "/affiliates/dashboard" : "/affiliates" };
  if (isOwnerPath(pathname)) return { notFound: true };
  return null;
}
