import NextAuth, { type NextAuthRequest } from "next-auth";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { isMerchantDomain } from "@/lib/merchantDomain";
import { proxyReadsSession, resolveLoginRedirect, resolveProductDomainRoute } from "@/lib/middlewareLogic";

// Uses the edge-safe authConfig directly (not the full config exported from
// @/lib/auth) so this proxy never pulls either Credentials provider —
// and their native/wasm or DB-heavy authorize() callbacks — into the Edge
// Proxy bundle. Decoding/verifying the JWT session cookie only needs
// the shared secret, session strategy, and callbacks, all present in
// authConfig.
const { auth } = NextAuth(authConfig);

async function productDomainResponse(
  req: NextRequest,
  role: "owner" | "affiliate" | null
): Promise<NextResponse | null> {
  const productRoute = resolveProductDomainRoute(req.nextUrl.pathname, role);
  // Only asked for the paths resolveProductDomainRoute cares about.
  if (!productRoute || !(await isMerchantDomain(req.headers.get("host")))) return null;
  if ("redirect" in productRoute) {
    return NextResponse.redirect(new URL(productRoute.redirect, req.nextUrl.origin));
  }
  // A path no route matches, so the app's own not-found page answers, with
  // its 404 status, instead of an empty body.
  return NextResponse.rewrite(new URL("/_supaffi/not-found", req.nextUrl.origin));
}

// The event parameter picks next-auth's proxy overload over its route handler one.
const withSession = auth(async (req: NextAuthRequest, _event: NextFetchEvent) => {
  const role = req.auth?.user?.role ?? null;
  const productResponse = await productDomainResponse(req, role);
  if (productResponse) return productResponse;

  const redirectPath = resolveLoginRedirect(req.nextUrl.pathname, role);
  if (redirectPath) {
    return NextResponse.redirect(new URL(redirectPath, req.nextUrl.origin));
  }

  return NextResponse.next();
});

export default async function proxy(req: NextRequest, event: NextFetchEvent) {
  if (proxyReadsSession(req.nextUrl.pathname)) return withSession(req, event);
  // Any other page only gets the affiliate-domain check, which answers null
  // without a lookup unless the path is the Owner signup page.
  return (await productDomainResponse(req, null)) ?? NextResponse.next();
}

export const config = {
  // Next needs these as constants, so the last entry stands in for the Owner
  // signup path a build may set: every other page, minus API routes, Next's
  // own files and anything with a file extension (the tracking script among
  // them). proxyReadsSession keeps the session to the paths listed first.
  matcher: [
    "/",
    "/login/:path*",
    "/setup/:path*",
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/affiliates/dashboard/:path*",
    "/((?!api/|_next/|_supaffi/|.*\\..*).*)",
  ],
};
