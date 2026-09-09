import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { developerBrief } from "@/lib/developerBrief";
import { REFERRAL_COOKIE, REFERRAL_METADATA_KEY } from "@/lib/referral";
import { nextStep, stepIndex, stepPath } from "@/lib/onboarding";
import { originFor } from "@/lib/url";
import { StepFrame } from "../../StepFrame";
import { Light } from "../../Light";
import { AutoRefresh } from "../../AutoRefresh";
import type { loadStepContext } from "../checks";

type Ctx = Awaited<ReturnType<typeof loadStepContext>>;

function Snippet({ code }: { code: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/40 p-3">
      <pre className="overflow-x-auto font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <div className="flex justify-end">
        <CopyLinkButton link={code} size="sm" label="Copy" />
      </div>
    </div>
  );
}

export function Tracking({ ctx }: { ctx: Ctx }) {
  const { merchant, checks } = ctx;
  // originFor, not a hardcoded https, so the snippet is a working URL on a
  // local instance too. Same builder as the dashboard's tracking screen.
  const scriptTag = `<script src="${originFor(merchant.domain)}/track.js" async></script>`;
  const checkoutSnippet = `// Wherever you create the Checkout Session, server side.
const referralToken = cookies.get("${REFERRAL_COOKIE}");

await stripe.checkout.sessions.create({
  // ...your existing options
  metadata: {
    // ...your existing metadata
    ...(referralToken && { ${REFERRAL_METADATA_KEY}: referralToken }),
  },
});`;
  const brief = developerBrief({
    productName: merchant.name,
    websiteUrl: merchant.websiteUrl,
    scriptTag,
    checkoutSnippet,
  });
  const next = nextStep("tracking", ctx.emailRequired)!;

  return (
    <StepFrame
      index={stepIndex("tracking", ctx.emailRequired)}
      total={ctx.total}
      title="Put the tracking script on your site"
    >
      <AutoRefresh active={!checks.tracking.script.ok} />
      <p className="text-sm">Paste this in the head of every page an affiliate link can land on.</p>
      <Snippet code={scriptTag} />
      <div className="rounded-xl border border-border/70 p-4">
        <Light result={checks.tracking.script} label={`Script found on ${new URL(merchant.websiteUrl).hostname}`} />
      </div>

      <p className="text-sm">Then, wherever you create the Stripe Checkout session.</p>
      <Snippet code={checkoutSnippet} />
      <p className="-mt-3 text-xs text-muted-foreground">Confirms itself on the first sale.</p>

      <div className="flex items-center gap-3 rounded-xl border border-dashed border-border p-4">
        <p className="flex-1 text-sm">Not the person who touches the code?</p>
        <CopyLinkButton link={brief} size="sm" label="Copy a brief for a developer" />
      </div>

      <div>
        <Button size="lg" className="cursor-pointer" render={<Link href={stepPath(merchant.slug, next)} />}>
          Continue
        </Button>
      </div>
    </StepFrame>
  );
}
