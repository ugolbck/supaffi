import { createOwner } from "@/lib/owner";
import { signIn } from "@/lib/auth";

// No file-level "use server" here: a "use server" file may only export async
// functions, but validateSetupInput is deliberately a plain sync function so
// it can be unit-tested directly. completeSetup carries its own inline
// "use server" instead — it's invoked from within the page's own server
// action wrapper, so it doesn't need to be a directly client-referenceable
// action itself, but marking it keeps it consistent and safely server-only.
export function validateSetupInput(
  email: string,
  password: string,
  confirmPassword: string
): string | null {
  if (!email) return "Email is required";
  if (password !== confirmPassword) return "Passwords do not match";
  if (password.length < 12) return "Password must be at least 12 characters";
  return null;
}

export async function completeSetup(formData: FormData): Promise<{ error: string } | never> {
  "use server";
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
