import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { getTrackingTimestamps } from "@/lib/tracking";
import { getProductMetrics } from "@/lib/analytics";
import { scriptFound } from "@/lib/checks/script";
import { developerBrief } from "@/lib/developerBrief";
import { originFor } from "@/lib/url";
import { CHECKOUT_SNIPPET } from "./TrackingSteps";
import { TrackingStatus } from "./TrackingStatus";

/**
 * Where tracking stands, and the two snippets that fix it when it does not.
 *
 * The script check is one fetch of the owner's homepage, run here rather than
 * through `runProductChecks`: the other six checks on that path are about
 * Stripe, email and DNS, and none of them belongs on this screen.
 */

export default async function TrackingPage({
  params,
}: {
  params: Promise<{ product: string }>;
}) {
  const { product } = await params;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const merchant = await getMerchantForOwnerBySlug(session.user.id, product);
  if (!merchant) notFound();

  // originFor, not a hardcoded https, so the snippet is a working URL on a
  // local instance too.
  const scriptTag = `<script src="${originFor(merchant.domain)}/track.js" async></script>`;

  const [script, timestamps, metrics] = await Promise.all([
    scriptFound(merchant.websiteUrl, merchant.domain),
    getTrackingTimestamps(merchant.id),
    getProductMetrics(session.user.id, merchant.id),
  ]);

  // Nothing to write: the check runs at render time, so asking again is asking
  // for this page to be rendered again.
  async function checkAgain(): Promise<void> {
    "use server";
    const session = await auth();
    if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
    revalidatePath(`/dashboard/products/${product}/tracking`);
  }

  return (
    <TrackingStatus
      merchant={merchant}
      script={script}
      clicks={metrics.clicks}
      series={metrics.series}
      lastClickAt={timestamps.lastClickAt}
      verifiedAt={timestamps.verifiedAt}
      scriptTag={scriptTag}
      checkoutSnippet={CHECKOUT_SNIPPET}
      brief={developerBrief({
        productName: merchant.name,
        websiteUrl: merchant.websiteUrl,
        scriptTag,
        checkoutSnippet: CHECKOUT_SNIPPET,
      })}
      checkAgain={checkAgain}
    />
  );
}
