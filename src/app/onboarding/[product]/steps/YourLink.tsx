import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { listProgramsForMerchant } from "@/lib/program";
import { stepPath } from "@/lib/onboarding";
import { originFor } from "@/lib/url";
import { StepFrame } from "../../StepFrame";
import { AutoRefresh } from "../../AutoRefresh";
import { finishOnboardingAction } from "../actions";
import type { loadStepContext } from "../checks";

type Ctx = Awaited<ReturnType<typeof loadStepContext>>;

export async function YourLink({ ctx }: { ctx: Ctx }) {
  const { merchant, checks, ownerId } = ctx;
  const [program] = await listProgramsForMerchant(ownerId, merchant.id);
  // Arriving here by URL with no program means there is no link to show.
  // Back to the step that makes one.
  if (!program) redirect(stepPath(merchant.slug, "terms"));

  const link = `${originFor(merchant.domain)}/affiliates/signup/${program.slug}`;
  const ready = checks.dns.resolves.ok && checks.dns.https.ok && checks.dns.certificate.ok;
  const site = new URL(merchant.websiteUrl).hostname;

  return (
    <StepFrame index={ctx.total} total={ctx.total} title="That is it. Here is your link.">
      <AutoRefresh active={!ready} />
      <div className="flex flex-col gap-3 rounded-xl border border-accent-200 bg-accent-50 p-4">
        <code className="break-all font-mono text-sm text-accent-800">{link}</code>
        <div className="flex gap-2">
          <CopyLinkButton link={link} size="sm" label="Copy" />
          <Button
            variant="ghost"
            size="sm"
            className="cursor-pointer"
            render={<a href={link} target="_blank" rel="noreferrer" />}
          >
            Preview
          </Button>
        </div>
      </div>
      <p className="text-sm text-pretty">
        Anyone who opens it can join your program in a minute and start sending people to {site}.
      </p>
      <div className="flex flex-col gap-2 text-sm">
        <p className="font-medium">Where to put it</p>
        <ul className="flex flex-col gap-1 text-muted-foreground">
          <li>A Partners or Affiliates link in your site footer</li>
          <li>Your newsletter</li>
          <li>A direct message to the five people who already talk about you</li>
        </ul>
      </div>
      <form action={finishOnboardingAction.bind(null, { id: merchant.id, slug: merchant.slug })}>
        <Button type="submit" size="lg" className="cursor-pointer" disabled={!ready}>
          Go to dashboard
        </Button>
        {!ready && (
          <p className="mt-2 text-xs text-muted-foreground">
            Waiting for your subdomain to resolve. The link will not open until it does.
          </p>
        )}
      </form>
    </StepFrame>
  );
}
