import Link from "next/link";
import { Button } from "@/components/ui/button";
import { resendDomainsUrl } from "@/lib/checks/email";
import { nextStep, stepPath, stepIndex } from "@/lib/onboarding";
import { StepFrame } from "../../StepFrame";
import { Light } from "../../Light";
import { AutoRefresh } from "../../AutoRefresh";
import type { loadStepContext } from "../checks";

type Ctx = Awaited<ReturnType<typeof loadStepContext>>;

export function EmailDomain({ ctx }: { ctx: Ctx }) {
  const { merchant, checks } = ctx;
  const next = nextStep("email-domain", ctx.emailRequired)!;
  return (
    <StepFrame
      index={stepIndex("email-domain", ctx.emailRequired)}
      total={ctx.total}
      title="Let Resend send from your domain"
      lede={`Emails come from affiliates@${merchant.domain}. Resend needs to know that domain is yours.`}
    >
      <AutoRefresh active={!checks.email.domain.ok} />
      <Button variant="secondary" className="w-fit cursor-pointer" render={<a href={resendDomainsUrl()} target="_blank" rel="noreferrer" />}>
        Add domain in Resend
      </Button>
      <p className="-mt-3 text-xs text-muted-foreground">Resend has its own one click for Cloudflare.</p>
      <div className="rounded-xl border border-border/70 p-4">
        <Light result={checks.email.domain} label="Domain verified in Resend" />
      </div>
      <div className="flex items-center gap-4">
        <Button size="lg" className="cursor-pointer" render={<Link href={stepPath(merchant.slug, next)} />}>
          Continue
        </Button>
        {!checks.email.domain.ok && <span className="text-xs text-muted-foreground">Checks again every 15 seconds</span>}
      </div>
    </StepFrame>
  );
}
