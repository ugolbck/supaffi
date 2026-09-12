import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EditableField } from "@/components/onboarding/EditableField";
import { StepShell } from "@/components/onboarding/StepShell";
import { TaskCard, TaskCardHeader, TaskCardSection } from "@/components/onboarding/TaskCard";
import { displayStep, nextStep, stepPath } from "@/lib/onboarding";
import { updateProductNameAction, updateProductWebsiteAction } from "../actions";
import type { Ctx } from "../checks";

/**
 * The product step, revisitable.
 *
 * It used to redirect to the subdomain step the moment a product existed, so
 * a website URL typed wrong during setup could never be corrected: the only
 * screen that owned that field was unreachable for the rest of the flow.
 */
export function Product({ ctx }: { ctx: Ctx }) {
  const { merchant } = ctx;
  const product = { id: merchant.id, slug: merchant.slug };
  const next = nextStep("product", ctx.emailRequired)!;

  return (
    <StepShell
      step={displayStep("product", ctx.emailRequired)}
      title="What are you promoting?"
      action={
        <Button size="lg" render={<Link href={stepPath(merchant.slug, next)} />}>
          Continue
        </Button>
      }
    >
      <TaskCard>
        <TaskCardHeader title="Name" />
        <TaskCardSection>
          <EditableField value={merchant.name} action={updateProductNameAction.bind(null, product)} label="Product name" mono={false} bare />
        </TaskCardSection>
        <TaskCardHeader title="Website" />
        <TaskCardSection>
          <EditableField value={merchant.websiteUrl} action={updateProductWebsiteAction.bind(null, product)} label="Website" bare />
        </TaskCardSection>
      </TaskCard>
    </StepShell>
  );
}
