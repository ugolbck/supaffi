import { listProgramsForMerchant } from "@/lib/program";
import { displayStep } from "@/lib/onboarding";
import { StepShell } from "@/components/onboarding/StepShell";
import { TermsForm, TERMS_DEFAULTS } from "@/components/TermsForm";
import { saveTermsAction } from "../actions";
import type { Ctx } from "../checks";

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
    <StepShell
      step={displayStep("terms", ctx.emailRequired)}
      title="What affiliates earn"
      lede="Sensible defaults are already filled in. Change them now or later."
    >
      <TermsForm
        action={saveTermsAction.bind(null, { id: merchant.id, slug: merchant.slug })}
        initial={initial}
        submitLabel="Continue"
      />
    </StepShell>
  );
}
