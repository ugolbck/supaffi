/**
 * Turns a name into the URL-safe fragment a referral code is built from:
 * lowercase letters and digits only, accents stripped, everything else
 * dropped, capped at 30 characters.
 *
 * Pure and free of any server-only import on purpose. `referralCode.ts` uses
 * it to generate a link code against the database, and the signup form
 * imports this same function client-side to preview that code live as
 * someone types their name, so the preview can never drift from what the
 * server actually assigns.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 30);
}
