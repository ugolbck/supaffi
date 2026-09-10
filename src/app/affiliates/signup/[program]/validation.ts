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

// Same rule `validateLinkInput` (src/lib/affiliateLink.ts) applies to a
// link's code, mirrored here rather than imported: that module opens a `db`
// connection at import time, which the signup form (a client component)
// cannot pull in just to validate a code as someone types it. Both copies
// enforce the identical pattern; the server has the final say regardless,
// since `createAffiliate` still hits the same unique constraint underneath.
const CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type CodeValidationResult = { error: null; code: string } | { error: string; code: null };

export function validateCode(input: string): CodeValidationResult {
  const code = input.trim().toLowerCase();
  if (code.length < 2 || code.length > 30) {
    return { error: "A code is between 2 and 30 characters.", code: null };
  }
  if (!CODE_PATTERN.test(code)) {
    return {
      error: "Use lowercase letters, numbers and hyphens, with no hyphen at either end.",
      code: null,
    };
  }
  return { error: null, code };
}
