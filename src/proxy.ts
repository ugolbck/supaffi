import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { db } from "@/lib/db";
import { resolveLoginRedirect, resolveProductDomainRoute } from "@/lib/middlewareLogic";
import { isLocalDomain } from "@/lib/url";

// Uses the edge-safe authConfig directly (not the full config exported from
// @/lib/auth) so this proxy never pulls either Credentials provider —
// and their native/wasm or DB-heavy authorize() callbacks — into the Edge
// Proxy bundle. Decoding/verifying the JWT session cookie only needs
// the shared secret, session strategy, and callbacks, all present in
// authConfig.
const { auth } = NextAuth(authConfig);

// Whether this request arrived on a product's affiliate domain. Only asked for
// the paths resolveProductDomainRoute cares about. A local host is never one:
// in development the dashboard and a product share localhost.
async function isProductDomain(host: string | null): Promise<boolean> {
  if (!host || isLocalDomain(host)) return false;
  const merchant = await db.merchant.findUnique({ where: { domain: host.toLowerCase() }, select: { id: true } });
  return merchant !== null;
}

export default auth(async (req) => {
  const productRoute = resolveProductDomainRoute(req.nextUrl.pathname);
  if (productRoute && (await isProductDomain(req.headers.get("host")))) {
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
