import { REFERRAL_COOKIE, REFERRAL_METADATA_KEY } from "@/lib/referral";

/**
 * The two things that go on the owner's own site.
 *
 * They used to be numbered steps on a setup screen. Onboarding has its own
 * copy of that walkthrough, so here they are snippets on a status page: an
 * owner comes back to this screen to copy one again, not to be walked through
 * both in order. Rendering them is the shared code block's job now.
 */

/** Wherever the Checkout Session is created, server side. */
export const CHECKOUT_SNIPPET = `// Wherever you create the Checkout Session, server side.
const referralToken = cookies.get("${REFERRAL_COOKIE}");

await stripe.checkout.sessions.create({
  // ...your existing options
  metadata: {
    // ...your existing metadata
    ...(referralToken && { ${REFERRAL_METADATA_KEY}: referralToken }),
  },
});`;
