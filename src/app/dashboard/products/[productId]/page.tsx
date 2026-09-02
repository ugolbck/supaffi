import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Check, Plug, Terminal } from "lucide-react";
import { auth } from "@/lib/auth";
import { getMerchantForOwner } from "@/lib/merchant";
import { listProgramsForMerchant } from "@/lib/program";
import { getProductSetup } from "@/lib/productSetup";
import { shouldCelebrateTracking } from "@/lib/tracking";
import { originFor } from "@/lib/url";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProductSetup } from "./ProductSetup";
import { TrackingVerified } from "./TrackingVerified";

function IntegrationPill({ label, connected }: { label: string; connected: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        connected ? "bg-status-success-bg text-status-success" : "bg-muted text-muted-foreground"
      }`}
    >
      {connected && <Check className="size-3" strokeWidth={3} />}
      {label}
      {!connected && <span className="opacity-70">not connected</span>}
    </span>
  );
}

// Console mode is neither connected nor missing, so it gets neither colour.
function ConsolePill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-100 px-2.5 py-1 text-xs font-medium text-accent-800">
      <Terminal className="size-3" />
      Email
      <span className="opacity-70">printed to terminal</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-(--radius-lg) border border-border/70 bg-elevated [background-image:var(--elevated-surface)] px-3.5 py-2.5 shadow-[var(--edge-light),var(--shadow-xs)]">
      <span className="font-heading text-lg font-semibold tracking-tight tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * A panel that owns its share of the viewport rather than growing forever.
 *
 * From `lg` up the page is exactly one screen tall and never scrolls: anything
 * with an unbounded number of rows (Programs) scrolls inside its own panel
 * instead of pushing the rest of the page off the bottom.
 *
 * Below `lg` there is only one column, so pinning to the viewport would leave
 * each panel a sliver too short to read. The page flows and scrolls there
 * instead, which is why every height rule here is `lg:`-prefixed.
 */
function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col lg:min-h-0 rounded-(--radius-xl) border border-border/70 bg-card [background-image:var(--card-surface)] shadow-[var(--edge-light),var(--shadow-sm)] ${className}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <h2 className="font-heading text-sm font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      <div className="flex flex-1 flex-col px-4 pb-4 lg:min-h-0">{children}</div>
    </section>
  );
}

export default async function MerchantDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId: merchantId } = await params;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const merchant = await getMerchantForOwner(session.user.id, merchantId);
  if (!merchant) notFound();

  const [programs, setup, celebrate] = await Promise.all([
    listProgramsForMerchant(session.user.id, merchant.id),
    getProductSetup(session.user.id, merchant.id),
    shouldCelebrateTracking(merchant.id),
  ]);

  // Counted separately from `integrationsConnected` because the pills below
  // exist precisely to show which one is missing. Email counts as handled in
  // console mode, where there is nothing to connect.
  const emailHandled = setup.emailConnected || !setup.emailRequired;
  const connectedCount = Number(setup.stripeConnected) + Number(emailHandled);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 lg:h-full lg:min-h-0">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading truncate text-xl font-extrabold tracking-tight">
            {merchant.name}
          </h1>
          <p className="truncate text-sm text-muted-foreground">{merchant.domain}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href={`/dashboard/products/${merchant.id}/edit`}>
            <Button variant="outline" size="sm">
              Edit details
            </Button>
          </Link>
          <Link href={`/dashboard/products/${merchant.id}/commissions`}>
            <Button size="sm">View commissions</Button>
          </Link>
        </div>
      </div>

      {celebrate && (
        <div className="shrink-0">
          <TrackingVerified merchantId={merchant.id} />
        </div>
      )}

      <div className="grid shrink-0 gap-3 sm:grid-cols-3">
        <Stat label="Affiliates" value={setup.affiliateCount} />
        <Stat label="Programs" value={programs.length} />
        <Stat
          label="Tracking"
          value={
            setup.trackingStatus === "verified"
              ? "Live"
              : setup.trackingStatus === "awaiting-sale"
                ? "Waiting"
                : "Off"
          }
        />
      </div>

      {/* The rest of the screen, split rather than stacked. Setup takes the
          larger share while it exists, and gives the space back once done. */}
      <div
        className={`grid gap-4 lg:min-h-0 lg:flex-1 ${
          setup.complete ? "lg:grid-cols-2" : "lg:grid-cols-5"
        }`}
      >
        {!setup.complete && (
          <ProductSetup
            className="lg:col-span-3"
            merchantId={merchant.id}
            merchantName={merchant.name}
            merchantDomain={merchant.domain}
            setup={setup}
          />
        )}

        <div className={`flex flex-col gap-4 lg:min-h-0 ${setup.complete ? "" : "lg:col-span-2"}`}>
          <Panel
            title="Integrations"
            action={
              <Link href={`/dashboard/products/${merchant.id}/integrations`}>
                <Button variant="outline" size="sm">
                  <Plug />
                  {connectedCount === 2 ? "Manage" : "Finish"}
                </Button>
              </Link>
            }
            className="shrink-0"
          >
            <div className="flex flex-wrap items-center gap-2">
              <IntegrationPill label="Stripe" connected={setup.stripeConnected} />
              {setup.emailConnected ? (
                <IntegrationPill label="Resend" connected />
              ) : setup.emailRequired ? (
                <IntegrationPill label="Resend" connected={false} />
              ) : (
                <ConsolePill />
              )}
            </div>
          </Panel>

          <Panel
            title="Programs"
            action={
              <Link href={`/dashboard/products/${merchant.id}/programs/new`}>
                <Button variant="outline" size="sm">
                  Create
                </Button>
              </Link>
            }
            className="lg:min-h-0 lg:flex-1"
          >
            {programs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Programs yet.</p>
            ) : (
              // The one unbounded list on this page, so it is the one thing
              // allowed its own scrollbar.
              <div className="flex flex-col gap-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                {programs.map((p) => (
                  <div
                    key={p.id}
                    className="flex shrink-0 flex-col gap-1 rounded-lg border border-border/70 bg-background/60 p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/dashboard/products/${merchant.id}/programs/${p.id}/edit`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {p.name}
                      </Link>
                      <Badge variant="outline">{String(p.defaultCommissionRate)}%</Badge>
                    </div>
                    <code className="truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {`${originFor(merchant.domain)}/affiliates/signup/${p.id}`}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
