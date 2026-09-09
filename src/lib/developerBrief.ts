/**
 * What a non technical owner forwards to whoever touches the code. Plain
 * text, both snippets, and one sentence per snippet on where it goes.
 */
export function developerBrief(input: {
  productName: string;
  websiteUrl: string;
  scriptTag: string;
  checkoutSnippet: string;
}): string {
  return [
    `Affiliate tracking for ${input.productName} (${input.websiteUrl})`,
    "",
    "1. Put this in the head of every page an affiliate link can land on:",
    "",
    input.scriptTag,
    "",
    "2. Wherever the Stripe Checkout Session is created, server side, pass the referral token through:",
    "",
    input.checkoutSnippet,
    "",
    "That is all. The first sale confirms it is working.",
  ].join("\n");
}
