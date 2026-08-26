import { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    redirect("/affiliates/login?error=missing_token");
  }

  try {
    await signIn("affiliate-token", {
      token,
      redirectTo: "/affiliates/dashboard",
    });
  } catch (err) {
    if (err instanceof AuthError) {
      redirect("/affiliates/login?error=invalid_token");
    }
    throw err; // Auth.js throws a redirect internally on success — must re-throw, not swallow
  }

  // Unreachable: every path above either redirects (throws) or re-throws.
  // Required so TypeScript sees a Response on every path a Route Handler's
  // GET can statically fall through.
  return NextResponse.redirect(new URL("/affiliates/dashboard", req.url));
}
