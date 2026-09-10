import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { CheckList } from "@/components/onboarding/CheckList";
import { StepShell } from "@/components/onboarding/StepShell";
import { TaskCard, TaskCardHeader, TaskCardSection } from "@/components/onboarding/TaskCard";
import { PasteField } from "@/components/PasteField";
import { displayStep, nextStep, stepPath } from "@/lib/onboarding";
import { saveEmailKeyAction } from "../actions";
import type { Ctx } from "../checks";

export function EmailKey({ ctx }: { ctx: Ctx }) {
  const { merchant, checks, setup } = ctx;
  const stored = setup.emailConnected;
  const next = nextStep("email-key", ctx.emailRequired)!;

  return (
    <StepShell
      step={displayStep("email-key", ctx.emailRequired)}
      title="Let Supaffi email your affiliates"
      lede="Affiliates log in with a link sent to their inbox."
      action={
        stored ? (
          <Button size="lg" render={<Link href={stepPath(merchant.slug, next)} />}>
            Continue
          </Button>
        ) : undefined
      }
    >
      <TaskCard>
        <TaskCardHeader
          title="Create a key in Resend"
          hint="Full access, on all domains"
          action={
            <Button
              variant="secondary"
              size="sm"
              render={<a href="https://resend.com/api-keys" target="_blank" rel="noreferrer" />}
            >
              <Image src="/logos/resend.svg" alt="" width={16} height={16} className="size-4" />
              Open Resend
            </Button>
          }
        />
        {stored && (
          <TaskCardSection sunken>
            <CheckList
              rows={[
                {
                  id: "key",
                  state: checks.email.key.ok ? "ok" : "failed",
                  pending: "Checking the key",
                  passed: "Supaffi can send email",
                  failed: "Resend rejected that key",
                  hint: checks.email.key.detail || "Create a new one and paste it again.",
                },
              ]}
            />
          </TaskCardSection>
        )}
      </TaskCard>

      <PasteField
        label={stored ? "Replace the key" : "Paste the key here"}
        placeholder="re_..."
        action={saveEmailKeyAction.bind(null, { id: merchant.id, slug: merchant.slug })}
        submitLabel={stored ? "Replace" : "Continue"}
      />
    </StepShell>
  );
}
