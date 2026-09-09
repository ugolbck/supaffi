import { headers } from "next/headers";
import { listMerchantsForOwner } from "@/lib/merchant";
import { stepStates, isStepId, type StepId } from "@/lib/onboarding";
import { Rail } from "../Rail";
import { loadStepContext } from "./checks";

export default async function ProductOnboardingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ product: string }>;
}) {
  const { product } = await params;
  const ctx = await loadStepContext(product);

  // The current step comes from the URL. Layouts do not receive the child
  // segment, so it is read from the pathname header the proxy sets.
  const pathname = (await headers()).get("x-pathname") ?? "";
  const last = pathname.split("/").pop() ?? "";
  const current: StepId = isStepId(last) ? last : "subdomain";

  const steps = stepStates({
    setup: ctx.setup,
    checks: ctx.checks,
    onboardingCompletedAt: ctx.onboardingCompletedAt,
    current,
  });
  const others = (await listMerchantsForOwner(ctx.ownerId)).filter((m) => m.id !== ctx.merchant.id);

  return (
    <>
      <Rail steps={steps} productSlug={ctx.merchant.slug} backHref={others.length > 0 ? "/dashboard" : null} />
      {children}
    </>
  );
}
