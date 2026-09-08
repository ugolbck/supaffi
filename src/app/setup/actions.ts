// No file-level "use server" here: a "use server" file may only export async
// functions, but validateSetupInput is deliberately a plain sync function so
// it can be unit-tested directly. The actual Server Action (completeSetup)
// lives in ./completeSetup.ts, a file-level "use server" module — needed so
// it can be imported directly by the client component (SetupForm.tsx) that
// wires it into useActionState.
import { MIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";

export function validateSetupInput(
  email: string,
  password: string,
  confirmPassword: string
): string | null {
  const trimmedEmail = email.trim();
  if (!trimmedEmail) return "Email is required";
  if (!trimmedEmail.includes("@")) return "Enter a valid email address";
  if (password !== confirmPassword) return "Passwords do not match";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}
