import { listProgramsForMerchant } from "@/lib/program";
import { stepIndex } from "@/lib/onboarding";
import { StepFrame } from "../../StepFrame";
import { TermsForm, TERMS_DEFAULTS } from "@/components/TermsForm";
import { saveTermsAction } from "../actions";
import type { loadStepContext } from "../checks";

type Ctx = Awaited<ReturnType<typeof loadStepContext>>;

export async function Terms({ ctx }: { ctx: Ctx }) {
  const { merchant, ownerId } = ctx;
  // Editing the first program rather than adding another is the action's
  // job; the form only needs the numbers already on it.
  const [first] = await listProgramsForMerchant(ownerId, merchant.id);
  const initial = first
    ? {
        name: first.name,
        defaultCommissionRate: String(first.defaultCommissionRate),
        commissionDurationType: first.commissionDurationType,
        commissionDurationMonths: first.commissionDurationMonths ? String(first.commissionDurationMonths) : "",
        attributionWindowDays: String(first.attributionWindowDays),
        holdingPeriodDays: String(first.holdingPeriodDays),
      }
    : TERMS_DEFAULTS;

  return (
    <StepFrame
      index={stepIndex("terms", ctx.emailRequired)}
      total={ctx.total}
      title="What affiliates earn"
    >
      <TermsForm
        action={saveTermsAction.bind(null, { id: merchant.id, slug: merchant.slug })}
        initial={initial}
        submitLabel="Continue"
      />
    </StepFrame>
  );
}
