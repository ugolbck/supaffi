import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { CheckList, checkState } from "@/components/onboarding/CheckList";
import { StepShell } from "@/components/onboarding/StepShell";
import { TaskCard, TaskCardHeader, TaskCardSection } from "@/components/onboarding/TaskCard";
import { resendDomainsUrl } from "@/lib/checks/email";
import { displayStep, nextStep, stepPath } from "@/lib/onboarding";
import { AutoRefresh } from "../../AutoRefresh";
import { recheckAction } from "../actions";
import type { Ctx } from "../checks";

export function EmailDomain({ ctx }: { ctx: Ctx }) {
  const { merchant, checks } = ctx;
  const product = { id: merchant.id, slug: merchant.slug };
  const next = nextStep("email-domain", ctx.emailRequired)!;
  const domainState = checkState(checks.email.domain, (detail) => detail.startsWith("Add ") || detail.startsWith("Added, "));

  return (
    <StepShell
      step={displayStep("email-domain", ctx.emailRequired)}
      title="Let Resend send from your domain"
      lede={`Emails to your affiliates come from affiliates@${merchant.domain}.`}
      action={
        <Button size="lg" render={<Link href={stepPath(merchant.slug, next)} />}>
          Continue
        </Button>
      }
    >
      <AutoRefresh active={domainState !== "ok"} />
      <TaskCard>
        <TaskCardHeader
          title="Add the domain in Resend"
          action={
            <Button
              variant="secondary"
              size="sm"
              render={<a href={resendDomainsUrl()} target="_blank" rel="noreferrer" />}
            >
              <Image src="/logos/resend.svg" alt="" width={16} height={16} className="size-4" />
              Open Resend
            </Button>
          }
        />
        <TaskCardSection sunken>
          <CheckList
            rows={[
              {
                id: "domain",
                state: domainState,
                pending: `Waiting for Resend to verify ${merchant.domain}`,
                passed: `Resend can send from ${merchant.domain}`,
                failed: checks.email.domain.detail,
                hint: "Open Resend and check the record it asked for.",
              },
            ]}
            onRecheck={recheckAction.bind(null, product, "email-domain")}
          />
        </TaskCardSection>
      </TaskCard>
    </StepShell>
  );
}
