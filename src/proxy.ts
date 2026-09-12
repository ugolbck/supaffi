import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { resolveLoginRedirect } from "@/lib/middlewareLogic";

// Uses the edge-safe authConfig directly (not the full config exported from
// @/lib/auth) so this proxy never pulls either Credentials provider —
// and their native/wasm or DB-heavy authorize() callbacks — into the Edge
// Proxy bundle. Decoding/verifying the JWT session cookie only needs
// the shared secret, session strategy, and callbacks, all present in
// authConfig.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const redirectPath = resolveLoginRedirect(req.nextUrl.pathname, req.auth?.user?.role ?? null);
  if (redirectPath) {
    return NextResponse.redirect(new URL(redirectPath, req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/dashboard/:path*", "/onboarding/:path*", "/affiliates/dashboard/:path*"],
};
