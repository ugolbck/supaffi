import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CheckList } from "@/components/onboarding/CheckList";
import { checkState, paymentKeyPending } from "@/components/onboarding/checkRows";
import { StepShell } from "@/components/onboarding/StepShell";
import { TaskCard, TaskCardSection } from "@/components/onboarding/TaskCard";
import { PasteField } from "@/components/PasteField";
import { displayStep, nextStep, stepPath } from "@/lib/onboarding";
import { polarDashboardUrl } from "@/lib/payments/polar/webhookEvents";
import { savePolarTokenAction } from "../actions";
import type { Ctx } from "../checks";

export function PolarToken({ ctx }: { ctx: Ctx }) {
  const { merchant, checks, setup } = ctx;
  const stored = setup.paymentKeyStored;
  const next = nextStep("payments")!;
  const product = { id: merchant.id, slug: merchant.slug };

  return (
    <StepShell
      step={displayStep("payments")}
      title="Let Supaffi receive your Polar sales"
      lede="In Polar, create an organization access token with the webhooks:read and webhooks:write scopes."
      action={
        stored ? (
          <Button size="lg" render={<Link href={stepPath(merchant.slug, next)} />}>
            Continue
          </Button>
        ) : undefined
      }
    >
      <div>
        <Button
          variant="secondary"
          size="lg"
          className="cursor-pointer"
          render={<a href={polarDashboardUrl(stored && merchant.paymentSandbox)} target="_blank" rel="noreferrer" />}
        >
          Open Polar
        </Button>
      </div>

      {stored && (
        <TaskCard>
          <TaskCardSection sunken>
            <CheckList
              rows={[
                {
                  id: "key",
                  state: checkState(checks.payments.key, paymentKeyPending),
                  pending: "Checking the token",
                  passed: "Supaffi receives your Polar sales",
                  failed: "Polar rejected that token",
                  hint: checks.payments.key.detail || "Create a new one and paste it again.",
                },
              ]}
            />
          </TaskCardSection>
        </TaskCard>
      )}

      <PasteField
        label={stored ? "Replace the token" : "Paste the token here"}
        placeholder="polar_oat_..."
        action={savePolarTokenAction.bind(null, product)}
        submitLabel={stored ? "Replace" : "Continue"}
      />
    </StepShell>
  );
}
