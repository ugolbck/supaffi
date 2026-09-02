import { redirect, notFound } from "next/navigation";
import { Check, Clock } from "lucide-react";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { getProductSetup, stepAfter } from "@/lib/productSetup";
import { getTrackingTimestamps } from "@/lib/tracking";
import { getProductMetrics } from "@/lib/analytics";
import { originFor } from "@/lib/url";
import { SetupShell, SetupPanel } from "../SetupShell";
import { TrackingSteps } from "./TrackingSteps";
import { TrackingStatus } from "./TrackingStatus";

function StatusPill({ status }: { status: "not-started" | "awaiting-sale" | "verified" }) {
  if (status === "verified") {
    return (
      <span className="inline-flex animate-in items-center gap-1 rounded-full bg-status-success-bg px-2 py-0.5 text-xs font-medium text-status-success zoom-in-95 duration-200 ease-[var(--ease-out)]">
        <Check className="size-3" strokeWidth={3} />
        Verified
      </span>
    );
  }
  if (status === "awaiting-sale") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent-100 px-2 py-0.5 text-xs font-medium text-accent-800">
        <Clock className="size-3" />
        Clicks arriving
      </span>
    );
  }
  return null;
}

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

  const setup = await getProductSetup(session.user.id, merchant.id);
  const status = setup.trackingStatus;
  // originFor, not a hardcoded https, so the snippet is a working URL on a
  // local instance too.
  const scriptTag = `<script src="${originFor(merchant.domain)}/track.js" async></script>`;

  if (setup.complete) {
    const [timestamps, metrics] = await Promise.all([
      getTrackingTimestamps(merchant.id),
      getProductMetrics(session.user.id, merchant.id),
    ]);
    return (
      <TrackingStatus
        merchant={merchant}
        status={status}
        lastClickAt={timestamps.lastClickAt}
        verifiedAt={timestamps.verifiedAt}
        clicks={metrics.clicks}
        series={metrics.series}
        scriptTag={scriptTag}
      />
    );
  }

  const next = stepAfter(merchant.slug, setup, 3);

  return (
    <SetupShell
      step={3}
      title="Install tracking"
      lede="Two snippets, both on your own site. The first records the click, the second tells Stripe which affiliate sent the sale."
      status={<StatusPill status={status} />}
      productSlug={merchant.slug}
      next={next}
      aside={
        <SetupPanel title="Where this stands" className="lg:flex-1">
          {/* Says what is actually known, which is never "done" until a real
              purchase has carried a token end to end. */}
          <p className="text-sm leading-relaxed text-muted-foreground">
            {status === "verified"
              ? "A sale came through carrying a referral token, so both halves are working."
              : status === "awaiting-sale"
                ? "Clicks are being recorded, so the script is live. The checkout half stays unconfirmed until the first sale."
                : "Nothing recorded yet. The first click on an affiliate link shows up here."}
          </p>
          {status !== "verified" && (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Nothing here blocks you. Recruit affiliates now and this finishes on its own.
            </p>
          )}
        </SetupPanel>
      }
    >
      <SetupPanel className="lg:flex-1 lg:overflow-y-auto">
        <TrackingSteps scriptTag={scriptTag} />
      </SetupPanel>
    </SetupShell>
  );
}
