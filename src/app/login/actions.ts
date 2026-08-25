"use server";

import { signIn } from "@/lib/auth";
import { AuthError } from "next-auth";

export async function login(formData: FormData): Promise<{ error: string } | never> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "Incorrect email or password" };
    }
    throw err; // Auth.js throws a redirect internally on success — must re-throw, not swallow
  }
  return { error: "" }; // unreachable on success (signIn redirects), keeps TypeScript happy
}
