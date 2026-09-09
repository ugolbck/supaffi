import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMerchantsForOwner } from "@/lib/merchant";
import { deliveryMode } from "@/lib/email/transport";
import { backToDashboardHref, stepIds, stepLabel } from "@/lib/onboarding";
import { Rail } from "./Rail";
import { StepFrame } from "./StepFrame";
import { ProductForm } from "./ProductForm";

export default async function OnboardingStart() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const existing = await listMerchantsForOwner(session.user.id);
  const emailRequired = deliveryMode() === "send";
  const ids = stepIds(emailRequired);

  // Install and account are shown as done so the user starts with progress
  // rather than at zero.
  const steps = ids.map((id, i) => ({
    id,
    label: stepLabel(id),
    index: i + 1,
    state: id === "product" ? ("current" as const) : ("upcoming" as const),
  }));

  return (
    <>
      <Rail steps={steps} productSlug={null} backHref={backToDashboardHref(existing)} />
      <StepFrame index={1} total={ids.length} title="What are you promoting?">
        <ProductForm />
      </StepFrame>
    </>
  );
}
