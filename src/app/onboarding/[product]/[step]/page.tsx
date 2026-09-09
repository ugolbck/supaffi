import { notFound, redirect } from "next/navigation";
import { listMerchantsForOwner } from "@/lib/merchant";
import { isStepId, stepIds, stepPath, stepStates, type StepId } from "@/lib/onboarding";
import { Rail } from "../../Rail";
import { loadStepContext } from "../checks";
import { Subdomain } from "../steps/Subdomain";

type Ctx = Awaited<ReturnType<typeof loadStepContext>>;

export default async function StepPage({ params }: { params: Promise<{ product: string; step: string }> }) {
  const { product, step } = await params;
  if (!isStepId(step)) notFound();
  const ctx = await loadStepContext(product);
  // A step the instance does not have — the email pair in console mode —
  // is not a 404, it is a URL that stopped existing. Land on the one after it.
  if (!stepIds(ctx.emailRequired).includes(step)) redirect(stepPath(product, "terms"));
  if (step === "product") redirect(stepPath(product, "subdomain"));

  // The rail is rendered here, not by the layout above. A layout is not
  // re-rendered when only the child segment changes, so a rail up there would
  // keep highlighting the previous step after every click on one of its own
  // links.
  const steps = stepStates({
    setup: ctx.setup,
    checks: ctx.checks,
    onboardingCompletedAt: ctx.onboardingCompletedAt,
    current: step,
  });
  const others = (await listMerchantsForOwner(ctx.ownerId)).filter((m) => m.id !== ctx.merchant.id);

  return (
    <>
      <Rail steps={steps} productSlug={ctx.merchant.slug} backHref={others.length > 0 ? "/dashboard" : null} />
      {stepBody(step, ctx)}
    </>
  );
}

// Later tasks add a case per step.
function stepBody(step: StepId, ctx: Ctx) {
  switch (step) {
    case "subdomain":
      return <Subdomain ctx={ctx} />;
    default:
      notFound();
  }
}
