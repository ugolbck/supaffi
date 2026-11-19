"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { merchantOnHost } from "@/app/affiliates/merchantOnHost";

export async function loginAffiliate(_prevState: { error: string }, formData: FormData): Promise<{ error: string }> {
  // The host the sign-in itself reads the product from.
  await merchantOnHost((await headers()).get("host"));
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
