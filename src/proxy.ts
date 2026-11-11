import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { isMerchantDomain } from "@/lib/merchantDomain";
import { resolveLoginRedirect, resolveProductDomainRoute } from "@/lib/middlewareLogic";

// Uses the edge-safe authConfig directly (not the full config exported from
// @/lib/auth) so this proxy never pulls either Credentials provider —
// and their native/wasm or DB-heavy authorize() callbacks — into the Edge
// Proxy bundle. Decoding/verifying the JWT session cookie only needs
// the shared secret, session strategy, and callbacks, all present in
// authConfig.
const { auth } = NextAuth(authConfig);

export default auth(async (req) => {
  const productRoute = resolveProductDomainRoute(req.nextUrl.pathname, req.auth?.user?.role ?? null);
  // Only asked for the paths resolveProductDomainRoute cares about.
  if (productRoute && (await isMerchantDomain(req.headers.get("host")))) {
    if ("redirect" in productRoute) {
      return NextResponse.redirect(new URL(productRoute.redirect, req.nextUrl.origin));
    }
    // A path no route matches, so the app's own not-found page answers, with
    // its 404 status, instead of an empty body.
    return NextResponse.rewrite(new URL("/_supaffi/not-found", req.nextUrl.origin));
  }

  const redirectPath = resolveLoginRedirect(req.nextUrl.pathname, req.auth?.user?.role ?? null);
  if (redirectPath) {
    return NextResponse.redirect(new URL(redirectPath, req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/",
    "/login/:path*",
    "/setup/:path*",
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/affiliates/dashboard/:path*",
  ],
};
