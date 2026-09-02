import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Activity, Check, Clock, Percent, Radio, Share2, Terminal } from "lucide-react";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { listProgramsForMerchant } from "@/lib/program";
import { getProductSetup } from "@/lib/productSetup";
import { getProductMetrics, getTopAffiliates, getRecentActivity } from "@/lib/analytics";
import { shouldCelebrateTracking } from "@/lib/tracking";
import { originFor } from "@/lib/url";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { PageShell, PageHeader, SignalRow, Band } from "@/components/dashboard/PageGrid";
import { StatTile } from "@/components/dashboard/StatTile";
import { DashboardCard, CardEmpty } from "@/components/dashboard/DashboardCard";
import { BarChart } from "@/components/charts/BarChart";
import { money, moneyHint } from "@/lib/format";
import { ProductSetup } from "./ProductSetup";
import { TrackingVerified } from "./TrackingVerified";

/**
 * One product's own dashboard: its numbers, or while setup is unfinished, the
 * one thing left to do.
 *
 * These are two screens, not one screen with a card added. Until setup is
 * complete every number here is a zero and every card an empty state, so the
 * page is the stepper and nothing else. The moment setup is done the numbers
 * arrive and the stepper is gone for good.
 */

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// A one-line status row is the exact shape this whole layout exists to
// remove: three of them centred in a tall card is empty space with icons on
// it. The secondary line under each label is what a real Stripe/Email/
// Tracking screen would tell you anyway, so the card earns its height
// instead of the body just centring three short rows in it.
function StatusRow({
  icon: Icon,
  label,
  detail,
  tone,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  detail: string;
  tone: "success" | "waiting" | "muted";
}) {
  const toneClass = {
    success: "bg-status-success-bg text-status-success",
    waiting: "bg-accent-100 text-accent-800",
    muted: "bg-muted text-muted-foreground",
  }[tone];

  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm">
      <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${toneClass}`}>
        <Icon className="size-3.5" strokeWidth={tone === "success" ? 3 : 2} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{label}</span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </div>
    </div>
  );
}

export default async function MerchantDetailPage({
  params,
}: {
  params: Promise<{ product: string }>;
}) {
  const { product } = await params;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const ownerId = session.user.id;
  const merchant = await getMerchantForOwnerBySlug(ownerId, product);
  if (!merchant) notFound();

  const base = `/dashboard/products/${merchant.slug}`;

  // Read on its own, ahead of everything else, because an unfinished product
  // renders none of the cards below and so needs none of their queries.
  const setup = await getProductSetup(ownerId, merchant.id);

  if (!setup.complete) {
    return (
      <PageShell>
        <PageHeader
          title={merchant.name}
          subtitle={merchant.domain}
          actions={
            <Link href={`${base}/edit`}>
              <Button variant="outline" size="sm" className="cursor-pointer">
                Settings
              </Button>
            </Link>
          }
        />
        <Band>
          <ProductSetup className="lg:col-span-12" productSlug={merchant.slug} setup={setup} />
        </Band>
      </PageShell>
    );
  }

  const [programs, celebrate, metrics, topAffiliates, activity] = await Promise.all([
    listProgramsForMerchant(ownerId, merchant.id),
    shouldCelebrateTracking(merchant.id),
    getProductMetrics(ownerId, merchant.id),
    getTopAffiliates(ownerId, merchant.id),
    getRecentActivity(ownerId, merchant.id),
  ]);

  const firstProgram = programs[0] ?? null;

  // Per day conversion rate, not carried on DayPoint itself: dividing at the
  // edge keeps analytics.ts free of a derived field only this tile needs.
  // Zero clicks reads as a zero rate rather than NaN or a hole in the line.
  const rateSeries = metrics.series.map((d) =>
    d.clicks === 0 ? 0 : Math.round((d.conversions / d.clicks) * 1000) / 10
  );

  // The Status card's Tracking row wants a last-click date. metrics.series
  // already carries a click count per day for the 30 day window, so the most
  // recent day with clicks > 0 in that window is read off it rather than
  // adding a second query just for a timestamp.
  const lastClickDay = [...metrics.series].reverse().find((d) => d.clicks > 0)?.date ?? null;
  const lastClickLabel = lastClickDay
    ? DATE.format(new Date(`${lastClickDay}T00:00:00Z`))
    : null;

  return (
    <PageShell>
      <PageHeader
        title={merchant.name}
        subtitle={merchant.domain}
        actions={
          <>
            <Link href={`${base}/edit`}>
              <Button variant="outline" size="sm" className="cursor-pointer">
                Settings
              </Button>
            </Link>
            <Link href={`${base}/commissions`}>
              <Button size="sm" className="cursor-pointer">
                Commissions
              </Button>
            </Link>
          </>
        }
      />

      <SignalRow columns={5}>
        <StatTile
          label="Clicks, 30 days"
          value={String(metrics.clicks)}
          series={metrics.series.map((d) => d.clicks)}
        />
        <StatTile
          label="Conversions"
          value={String(metrics.conversions)}
          series={metrics.series.map((d) => d.conversions)}
        />
        <StatTile label="Rate" value={`${metrics.conversionRate}%`} series={rateSeries} />
        <StatTile
          label="Owed"
          value={money(metrics.owed)}
          hint={moneyHint(metrics.owed)}
          tone={metrics.owed.length > 0 ? "success" : "neutral"}
        />
        <StatTile label="Paid out" value={money(metrics.paid)} hint={moneyHint(metrics.paid)} />
      </SignalRow>

      <Band>
        <DashboardCard
          title="Performance"
          className="lg:col-span-8"
          action={<span className="text-xs text-muted-foreground">Last 30 days</span>}
        >
          {metrics.clicks === 0 ? (
            <CardEmpty icon={Radio} title="No clicks in the last 30 days." />
          ) : (
            <BarChart series={metrics.series} />
          )}
        </DashboardCard>

        <DashboardCard title="Top affiliates" className="lg:col-span-4" bodyScrolls>
          {topAffiliates.length === 0 ? (
            <CardEmpty
              icon={Share2}
              title="No affiliates yet."
              action={
                firstProgram ? (
                  <CopyLinkButton
                    size="sm"
                    link={`${originFor(merchant.domain)}/affiliates/signup/${firstProgram.slug}`}
                  />
                ) : (
                  <Link href={`${base}/programs/new`}>
                    <Button size="sm" className="cursor-pointer">
                      New program
                    </Button>
                  </Link>
                )
              }
            />
          ) : (
            <ul className="flex flex-col gap-1">
              {topAffiliates.map((affiliate, i) => (
                <li key={affiliate.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {affiliate.name ?? affiliate.email}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {affiliate.clicks} clk
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums">
                    {money(affiliate.earned)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>
      </Band>

      <Band>
        <DashboardCard title="Recent activity" className="lg:col-span-5" bodyScrolls>
          {activity.length === 0 ? (
            <CardEmpty icon={Activity} title="No activity yet." />
          ) : (
            <ul className="flex flex-col gap-1">
              {activity.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm"
                >
                  <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {DATE.format(item.at)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {item.affiliateName ?? item.affiliateEmail}
                  </span>
                  {item.kind === "signup" ? (
                    <span className="shrink-0 text-xs text-muted-foreground">joined</span>
                  ) : (
                    <span className="shrink-0 font-mono text-xs tabular-nums">
                      {item.amount} {item.currency?.toUpperCase()}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>

        <DashboardCard
          title="Programs"
          className="lg:col-span-4"
          bodyScrolls
          footer={
            <Link href={`${base}/programs/new`}>
              <Button variant="outline" size="sm" className="w-full cursor-pointer">
                New program
              </Button>
            </Link>
          }
        >
          {programs.length === 0 ? (
            <CardEmpty icon={Percent} title="No programs yet." />
          ) : (
            <div className="flex flex-col gap-2">
              {programs.map((p) => {
                const link = `${originFor(merchant.domain)}/affiliates/signup/${p.slug}`;
                return (
                  <div
                    key={p.id}
                    className="flex flex-col gap-1.5 rounded-lg border border-border/70 bg-background/60 p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{p.name}</span>
                      <Badge variant="outline">{String(p.defaultCommissionRate)}%</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {p.affiliateCount === 1 ? "1 affiliate" : `${p.affiliateCount} affiliates`}
                    </span>
                    <div className="flex items-center justify-between gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {link}
                      </code>
                      <CopyLinkButton size="sm" link={link} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardCard>

        <DashboardCard
          title="Status"
          className="lg:col-span-3"
          bodyClassName="gap-1"
          footer={
            <Link href={`${base}/integrations`}>
              <Button variant="outline" size="sm" className="w-full cursor-pointer">
                Manage
              </Button>
            </Link>
          }
        >
          {celebrate && (
            <div className="pb-1.5">
              <TrackingVerified merchantId={merchant.id} />
            </div>
          )}
          <StatusRow icon={Check} label="Stripe" detail="Connected" tone="success" />
          {setup.emailConnected ? (
            <StatusRow icon={Check} label="Email" detail="Sending via Resend" tone="success" />
          ) : (
            <StatusRow icon={Terminal} label="Email" detail="Printed to the terminal" tone="muted" />
          )}
          {setup.trackingStatus === "verified" ? (
            <StatusRow
              icon={Check}
              label="Tracking"
              detail={lastClickLabel ? `Live, last click ${lastClickLabel}` : "Live"}
              tone="success"
            />
          ) : (
            <StatusRow
              icon={Clock}
              label="Tracking"
              detail={lastClickLabel ? `Waiting on a sale, last click ${lastClickLabel}` : "Waiting on a sale"}
              tone="waiting"
            />
          )}
        </DashboardCard>
      </Band>
    </PageShell>
  );
}
