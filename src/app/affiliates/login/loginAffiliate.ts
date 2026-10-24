"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export async function loginAffiliate(_prevState: { error: string }, formData: FormData): Promise<{ error: string }> {
  try {
    await signIn("affiliate-password", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/affiliates/dashboard",
    });
  } catch (err) {
    if (err instanceof AuthError) return { error: "Incorrect email or password" };
    throw err; // Auth.js throws a redirect internally on success, must re-throw
  }
  return { error: "" };
}
