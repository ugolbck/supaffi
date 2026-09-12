import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { getTrackingTimestamps } from "@/lib/tracking";
import { getProductMetrics } from "@/lib/analytics";
import { runProductChecks, type CheckSection } from "@/lib/checks/product";
import { trackingScriptPrompt, checkoutPrompt } from "@/lib/integrationPrompt";
import { originFor } from "@/lib/url";
import { CHECKOUT_SNIPPET } from "./TrackingSteps";
import { TrackingStatus } from "./TrackingStatus";

/**
 * Where tracking stands, and the two snippets that fix it when it does not.
 *
 * The script light comes from the same cache the rest of the dashboard reads,
 * so opening this screen right after settings does not fetch the owner's
 * homepage twice. "Check the site again" is the one thing that overrides it:
 * it lands on `?fresh=1`, which asks for the tracking section and only that
 * section to be run for real.
 */

export default async function TrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ product: string }>;
  searchParams: Promise<{ fresh?: string }>;
}) {
  const { product } = await params;
  const query = await searchParams;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const ownerId = session.user.id;
  const merchant = await getMerchantForOwnerBySlug(ownerId, product);
  if (!merchant) notFound();

  // originFor, not a hardcoded https, so the snippet is a working URL on a
  // local instance too.
  const scriptTag = `<script src="${originFor(merchant.domain)}/track.js" async></script>`;

  // A flag, not a value: anything but the one string it is set to reads as
  // off, so a URL somebody made up cannot ask for anything else.
  const forceFresh = query.fresh === "1";

  const [checks, timestamps, metrics] = await Promise.all([
    runProductChecks(
      ownerId,
      merchant.id,
      forceFresh ? { fresh: new Set<CheckSection>(["tracking"]) } : {}
    ),
    getTrackingTimestamps(merchant.id),
    getProductMetrics(ownerId, merchant.id),
  ]);

  // Nothing to write: the check runs at render time, so asking again is asking
  // for this page to be rendered again, with the cached tracking result
  // skipped.
  const trackingHref = `/dashboard/products/${merchant.slug}/tracking`;
  async function checkAgain(): Promise<void> {
    "use server";
    const session = await auth();
    if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
    revalidatePath(trackingHref);
    redirect(`${trackingHref}?fresh=1`);
  }

  return (
    <TrackingStatus
      merchant={merchant}
      script={checks.tracking.script}
      clicks={metrics.clicks}
      series={metrics.series}
      lastClickAt={timestamps.lastClickAt}
      verifiedAt={timestamps.verifiedAt}
      scriptTag={scriptTag}
      checkoutSnippet={CHECKOUT_SNIPPET}
      scriptPrompt={trackingScriptPrompt({ websiteUrl: merchant.websiteUrl, scriptTag })}
      checkoutPromptText={checkoutPrompt({ checkoutSnippet: CHECKOUT_SNIPPET })}
      checkAgain={checkAgain}
    />
  );
}
