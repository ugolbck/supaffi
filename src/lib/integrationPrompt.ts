/**
 * The text behind "Copy AI prompt", one per snippet.
 *
 * This replaces a single "brief for a developer" that lived in its own card
 * asking whether the reader was the person who touches the code. Almost
 * nobody forwards a brief to a colleague any more; they paste it into an
 * assistant. So the prompt sits on the code it describes, and it is written
 * as an instruction to that assistant rather than as a note to a human.
 */
export function trackingScriptPrompt(input: { websiteUrl: string; scriptTag: string }): string {
  return [
    `Add affiliate tracking to my website (${input.websiteUrl}).`,
    "",
    "Put this script tag in the <head> of every page a visitor can land on:",
    "",
    input.scriptTag,
    "",
    "Do not defer or lazy-load it, and do not move it into a click handler.",
  ].join("\n");
}

export function checkoutPrompt(input: { checkoutSnippet: string }): string {
  return [
    "Update my Stripe Checkout code so affiliate referrals are attributed.",
    "",
    "Wherever the Checkout Session is created server side, read the referral",
    "cookie and pass it through in the session metadata, like this:",
    "",
    input.checkoutSnippet,
    "",
    "Keep any metadata that is already being set.",
  ].join("\n");
}
