"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

// The token is only spent here, on the Affiliate pressing "Log in", never on
// the link being opened. See page.tsx.
export async function verifyAffiliateLogin(formData: FormData): Promise<void> {
  const token = formData.get("token");
  if (typeof token !== "string" || !token) {
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
}
