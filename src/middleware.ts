import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { shouldRedirectToLogin } from "@/lib/middlewareLogic";

// Uses the edge-safe authConfig directly (not the full config exported from
// @/lib/auth) so this middleware never pulls the Credentials provider — and
// its argon2 native/wasm dependency — into the Edge Middleware bundle.
// Decoding/verifying the JWT session cookie only needs the shared secret
// and session strategy, both present in authConfig.
const { auth } = NextAuth(authConfig);

export { shouldRedirectToLogin };

export default auth((req) => {
  if (shouldRedirectToLogin(req.nextUrl.pathname, !!req.auth)) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }
});

export const config = {
  matcher: ["/dashboard/:path*"],
};
