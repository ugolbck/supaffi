import { requireOwner } from "@/app/requireOwner";
import { listMerchantsForOwner } from "@/lib/merchant";
import { backToDashboardHref, displayStep, stepIds, stepLabel } from "@/lib/onboarding";
import { StepShell } from "@/components/onboarding/StepShell";
import { Rail } from "./Rail";
import { ProductForm } from "./ProductForm";

export default async function OnboardingStart() {
  const ownerId = await requireOwner();
  const existing = await listMerchantsForOwner(ownerId);
  const ids = stepIds();

  const steps = ids.map((id, i) => ({
    id,
    label: stepLabel(id),
    index: i + 1,
    state: id === "product" ? ("current" as const) : ("upcoming" as const),
  }));

  return (
    <>
      <Rail steps={steps} productSlug={null} backHref={backToDashboardHref(existing)} />
      <StepShell
        step={displayStep("product")}
        title="What are you promoting?"
      >
        <ProductForm />
      </StepShell>
    </>
  );
}
