import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug, getOnboardingState } from "@/lib/merchant";
import { getProductSetup } from "@/lib/productSetup";
import { runProductChecks } from "@/lib/checks/product";
import { stepIds } from "@/lib/onboarding";

// One set of checks per request. The layout and the page both need them,
// and running Stripe and Resend calls twice per render is the kind of thing
// that gets an instance rate limited during the one hour it matters.
export const loadStepContext = cache(async (slug: string) => {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  const ownerId = session.user.id;

  const merchant = await getMerchantForOwnerBySlug(ownerId, slug);
  if (!merchant) redirect("/onboarding");

  const [setup, checks, state] = await Promise.all([
    getProductSetup(ownerId, merchant.id),
    runProductChecks(ownerId, merchant.id),
    getOnboardingState(ownerId, merchant.id),
  ]);

  return {
    ownerId,
    merchant,
    setup,
    checks,
    onboardingCompletedAt: state.onboardingCompletedAt,
    emailRequired: setup.emailRequired,
    total: stepIds(setup.emailRequired).length,
  };
});
