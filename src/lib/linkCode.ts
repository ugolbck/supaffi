// The rule a referral code must satisfy: 2 to 30 characters, lowercase
// letters, digits and single hyphens, none at either end. Pure and free of
// any database import on purpose, same reasoning as `slugify.ts`:
// `src/lib/affiliateLink.ts`'s `validateLinkInput` is the actual authority
// (backed by the db's unique constraint on `AffiliateLink.code`), but it
// also opens a `db` connection at import time, which the signup form's
// client-side live preview cannot pull in just to validate a code as
// someone types it. Both import this instead of carrying their own copy of
// the pattern and its messages, so they can never drift out of sync.

export const CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
