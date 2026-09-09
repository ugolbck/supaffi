import { CopyLinkButton } from "@/components/CopyLinkButton";
import { REFERRAL_COOKIE, REFERRAL_METADATA_KEY } from "@/lib/referral";

/**
 * The two things that go on the owner's own site.
 *
 * They used to be numbered steps on a setup screen. Onboarding has its own
 * copy of that walkthrough, so here they are two labelled snippets on a status
 * page: an owner comes back to this screen to copy one again, not to be walked
 * through both in order.
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

export function Snippet({ code, label = "Copy" }: { code: string; label?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <pre className="min-w-0 overflow-x-auto rounded-lg bg-muted/60 px-3 py-2.5 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <div className="flex justify-end">
        <CopyLinkButton link={code} size="sm" label={label} />
      </div>
    </div>
  );
}
