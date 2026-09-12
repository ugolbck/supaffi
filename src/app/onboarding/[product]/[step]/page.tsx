import { notFound, redirect } from "next/navigation";
import { listMerchantsForOwner } from "@/lib/merchant";
import { backToDashboardHref, isStepId, stepIds, stepPath, stepStates, type StepId } from "@/lib/onboarding";
import { isDevInstance } from "@/lib/instanceMode";
import { isLocalDomain } from "@/lib/url";
import { Rail } from "../../Rail";
import { loadChecks, loadStepContext, type Ctx } from "../checks";
import { Product } from "../steps/Product";
import { Subdomain } from "../steps/Subdomain";
import { StripeKey } from "../steps/StripeKey";
import { Email } from "../steps/Email";
import { Terms } from "../steps/Terms";
import { Tracking } from "../steps/Tracking";

export default async function StepPage({ params }: { params: Promise<{ product: string; step: string }> }) {
  const { product, step } = await params;
  if (!isStepId(step)) notFound();
  const context = await loadStepContext(product);
  // A step the instance does not have — the email pair in console mode —
  // is not a 404, it is a URL that stopped existing. Land on the one after it.
  if (!stepIds(context.emailRequired).includes(step)) redirect(stepPath(product, "terms"));

  // Only this step's own section is re-run; the rest of the rail is whatever
  // the last run found, which is what makes a 15 second poll cheap.
  const checks = await loadChecks(context.ownerId, context.merchant.id, step);
  const ctx: Ctx = { ...context, checks };

  // The rail is rendered here, not by the layout above. A layout is not
  // re-rendered when only the child segment changes, so a rail up there would
  // keep highlighting the previous step after every click on one of its own
  // links.
  const steps = stepStates({
    setup: ctx.setup,
    checks,
    onboardingCompletedAt: ctx.onboardingCompletedAt,
    current: step,
    // Same test the subdomain screen itself makes: where the record can
    // never resolve, the rail does not hold the step open for it.
    dnsUnavailable: isDevInstance() || isLocalDomain(ctx.merchant.domain),
  });
  const others = (await listMerchantsForOwner(ctx.ownerId)).filter((m) => m.id !== ctx.merchant.id);

  return (
    <>
      <Rail steps={steps} productSlug={ctx.merchant.slug} backHref={backToDashboardHref(others)} />
      {stepBody(step, ctx)}
    </>
  );
}

function stepBody(step: StepId, ctx: Ctx) {
  switch (step) {
    case "product":
      return <Product ctx={ctx} />;
    case "subdomain":
      return <Subdomain ctx={ctx} />;
    case "stripe-key":
      return <StripeKey ctx={ctx} />;
    case "email":
      return <Email ctx={ctx} />;
    case "terms":
      return <Terms ctx={ctx} />;
    case "tracking":
      return <Tracking ctx={ctx} />;
    default:
      notFound();
  }
}
