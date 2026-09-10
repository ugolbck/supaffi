import { Button } from "@/components/ui/button";
import { CheckList } from "@/components/onboarding/CheckList";
import { CodeBlock } from "@/components/onboarding/CodeBlock";
import { StepShell, StepLabel } from "@/components/onboarding/StepShell";
import { TaskCard, TaskCardSection } from "@/components/onboarding/TaskCard";
import { trackingScriptPrompt, checkoutPrompt } from "@/lib/integrationPrompt";
import { REFERRAL_COOKIE, REFERRAL_METADATA_KEY } from "@/lib/referral";
import { displayStep, siteHost } from "@/lib/onboarding";
import { originFor } from "@/lib/url";
import { FinishedModal } from "@/components/onboarding/FinishedModal";
import { listProgramsForMerchant } from "@/lib/program";
import { AutoRefresh } from "../../AutoRefresh";
import { finishOnboardingAction, recheckAction } from "../actions";
import type { Ctx } from "../checks";

export async function Tracking({ ctx }: { ctx: Ctx }) {
  const { merchant, checks } = ctx;
  const product = { id: merchant.id, slug: merchant.slug };
  // originFor, not a hardcoded https, so the snippet is a working URL on a
  // local instance too.
  const scriptTag = `<script src="${originFor(merchant.domain)}/track.js" async></script>`;
  const checkoutSnippet = `const referralToken = cookies.get("${REFERRAL_COOKIE}");

await stripe.checkout.sessions.create({
  // ...your existing options
  metadata: {
    // ...your existing metadata
    ...(referralToken && { ${REFERRAL_METADATA_KEY}: referralToken }),
  },
});`;
  const site = siteHost(merchant.websiteUrl);
  const found = checks.tracking.script.ok;
  // Finishing happens on this screen, so the reward does too. The step stays
  // rendered behind the glass rather than being replaced by a new page.
  const [program] = ctx.onboardingCompletedAt ? await listProgramsForMerchant(ctx.ownerId, merchant.id) : [];

  return (
    <StepShell
      step={displayStep("tracking", ctx.emailRequired)}
      title="Put the tracking script on your site"
      lede="Paste this in the head of every page an affiliate link can land on."
      action={
        <form action={finishOnboardingAction.bind(null, { id: merchant.id, slug: merchant.slug })}>
          <Button type="submit" size="lg">
            Finish
          </Button>
        </form>
      }
    >
      <AutoRefresh active={!found} />
      <CodeBlock
        title="Tracking script"
        code={scriptTag}
        prompt={trackingScriptPrompt({ websiteUrl: merchant.websiteUrl, scriptTag })}
      />
      <TaskCard>
        <TaskCardSection sunken>
          <CheckList
            rows={[
              {
                id: "script",
                state: found ? "ok" : "failed",
                pending: `Looking for the script on ${site}`,
                passed: `Script is live on ${site}`,
                failed: checks.tracking.script.detail,
                hint: "Paste the script above into the page, then check again.",
              },
            ]}
            onRecheck={recheckAction.bind(null, product, "tracking")}
          />
        </TaskCardSection>
      </TaskCard>

      <StepLabel>Then, wherever you create the Stripe checkout session.</StepLabel>
      <CodeBlock title="Checkout session" code={checkoutSnippet} prompt={checkoutPrompt({ checkoutSnippet })} />
      {program && (
        <FinishedModal
          link={`${originFor(merchant.domain)}/affiliates/signup/${program.slug}`}
          dashboardHref={`/dashboard/products/${merchant.slug}`}
        />
      )}
    </StepShell>
  );
}
