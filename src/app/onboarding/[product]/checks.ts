import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug, getOnboardingState } from "@/lib/merchant";
import { getProductSetup } from "@/lib/productSetup";
import { runProductChecks, type ProductChecks } from "@/lib/checks/product";
import { checkSectionFor, stepIds, type StepId } from "@/lib/onboarding";

// Who and what, once per request. The layout, the page and every step share
// this, so resolving the product and reading its setup happens once however
// many of them render.
export const loadStepContext = cache(async (slug: string) => {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  const ownerId = session.user.id;

  const merchant = await getMerchantForOwnerBySlug(ownerId, slug);
  if (!merchant) redirect("/onboarding");

  const [setup, state] = await Promise.all([
    getProductSetup(ownerId, merchant.id),
    getOnboardingState(ownerId, merchant.id),
  ]);

  return {
    ownerId,
    merchant,
    setup,
    onboardingCompletedAt: state.onboardingCompletedAt,
    emailRequired: setup.emailRequired,
    total: stepIds(setup.emailRequired).length,
  };
});

// The lights. Separate from the context above because only the step screen
// needs them: the layout and the product page would otherwise run seven
// outside calls to render a redirect. The step names its own section, which
// is the one thing polling has to see move; the rest of the rail is served
// from the last run.
export const loadChecks = cache(
  async (ownerId: string, merchantId: string, current: StepId): Promise<ProductChecks> => {
    const section = checkSectionFor(current);
    return runProductChecks(ownerId, merchantId, {
      fresh: section ? new Set([section]) : undefined,
    });
  }
);

/** Everything a step screen is handed: the request's context plus its lights. */
export type Ctx = Awaited<ReturnType<typeof loadStepContext>> & { checks: ProductChecks };
