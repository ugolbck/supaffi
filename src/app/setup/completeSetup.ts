"use server";

import { createOwner } from "@/lib/owner";
import { signIn } from "@/lib/auth";
import { validateSetupInput } from "./actions";

export async function completeSetup(
  // Required by useActionState's action contract even though this function
  // doesn't read it — it always derives the next state from scratch.
  _prevState: { error: string },
  formData: FormData
): Promise<{ error: string } | never> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const validationError = validateSetupInput(email, password, confirmPassword);
  if (validationError) {
    return { error: validationError };
  }

  await createOwner(email, password);
  await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  // unreachable — signIn redirects on success
  return { error: "" };
}
