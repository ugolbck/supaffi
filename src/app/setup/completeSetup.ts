"use server";

import { createOwner } from "@/lib/owner";
import { signIn } from "@/lib/auth";
import { verifySetupToken, clearSetupToken } from "@/lib/setupToken";
import { validateSetupInput } from "./actions";

export async function completeSetup(
  // Required by useActionState's action contract even though this function
  // doesn't read it — it always derives the next state from scratch.
  _prevState: { error: string },
  formData: FormData
): Promise<{ error: string } | never> {
  // Checked first, before the password is read or hashed. This endpoint is
  // reachable by anyone until an Owner exists, and hashing costs 64 MiB of
  // Argon2id per call, so an unauthenticated caller must never reach it.
  const token = String(formData.get("setupToken") ?? "").trim();
  if (!verifySetupToken(token)) {
    return { error: "That setup token is not valid. Check this instance's logs." };
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const validationError = validateSetupInput(email, password, confirmPassword);
  if (validationError) {
    return { error: validationError };
  }

  await createOwner(email, password);
  // Discarded before signIn, which throws a redirect and never returns.
  clearSetupToken();
  await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  // unreachable — signIn redirects on success
  return { error: "" };
}
