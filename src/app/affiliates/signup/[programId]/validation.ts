export type SignupInput = { name: string; email: string };

export type SignupValidationResult =
  | { error: null; name: string; email: string }
  | { error: string; name: null; email: null };

export function validateSignupInput(input: SignupInput): SignupValidationResult {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();

  if (!name) return { error: "Name is required", name: null, email: null };
  if (!email.includes("@")) {
    return { error: "Enter a valid email address", name: null, email: null };
  }

  return { error: null, name, email };
}
