import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug, getOnboardingState } from "@/lib/merchant";
import { getProductSetup } from "@/lib/productSetup";
import { resumeStep, stepPath } from "@/lib/onboarding";
import {
  change,
  getProductMetrics,
  getTopAffiliates,
  getPayableGroups,
  pickCurrency,
  rangeFromQuery,
  rangeLabel,
  resolveRange,
} from "@/lib/analytics";
import { shouldCelebrateTracking } from "@/lib/tracking";
import { originFor } from "@/lib/url";
import { formatCount, formatMoney, money, moneyHint, prefer } from "@/lib/format";
import { Page, PageTitle, Tiles, Section } from "@/components/dashboard/Page";
import { StatTile } from "@/components/dashboard/StatTile";
import { Light } from "@/components/dashboard/Light";
import { TopAffiliates } from "@/components/dashboard/TopAffiliates";
import { Attention } from "@/components/dashboard/Attention";
import { ShieldAlert, Wallet } from "lucide-react";
import { ActivityChart } from "@/components/charts/ActivityChart";
import { RangePicker } from "@/components/charts/RangePicker";
import { CurrencyPicker } from "@/components/charts/CurrencyPicker";
import { TrackingVerified } from "./TrackingVerified";
import { Welcome } from "./Welcome";

/**
 * One product's own dashboard: what it did, and what is waiting on the Owner.
 *
 * There is no half-built version of this screen. A product whose onboarding is
 * unfinished redirects into onboarding, which owns every setup step, so
 * everything below can assume the product works.
 *
 * Nothing here fills space it has not earned. With no clicks, no signups and
 * nobody recruited there is no chart, no top-affiliate list and no activity
 * feed — a single line saying which of the two things it is still waiting for.
 */
export default async function ProductOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ product: string }>;
  searchParams: Promise<{ range?: string; currency?: string }>;
}) {
  const { product } = await params;
  const query = await searchParams;
  const range = rangeFromQuery(query.range);
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const ownerId = session.user.id;
  const merchant = await getMerchantForOwnerBySlug(ownerId, product);
  if (!merchant) notFound();

  // Read on their own, ahead of everything else, because a product still in
  // onboarding renders none of what follows and so needs none of its queries.
  const [onboarding, setup] = await Promise.all([
    getOnboardingState(ownerId, merchant.id),
    getProductSetup(ownerId, merchant.id),
  ]);

  if (!onboarding.onboardingCompletedAt) {
    const next = resumeStep(setup, null);
    redirect(next ? stepPath(merchant.slug, next) : `/onboarding/${merchant.slug}`);
  }

  const window = resolveRange(range, new Date(), merchant.createdAt);
  const [metrics, top, payable, celebrate] = await Promise.all([
    getProductMetrics(ownerId, merchant.id, range),
    getTopAffiliates(ownerId, merchant.id, 5, window),
    getPayableGroups(ownerId, merchant.id),
    shouldCelebrateTracking(merchant.id),
  ]);

  // Commissions, not groups: the Owner pays per affiliate but is counting
  // lines on a ledger.
  const currency = pickCurrency(metrics.currencies, query.currency);
  const payableTotal = payable.reduce((n, g) => n + g.commissionIds.length, 0);
  const empty = metrics.clicks === 0 && metrics.signups === 0 && setup.affiliateCount === 0;

  const signupLink = setup.firstProgramSlug
    ? `${originFor(merchant.domain)}/affiliates/signup/${setup.firstProgramSlug}`
    : null;

  // The banner onboarding hands over. It stays until somebody signs up or the
  // Owner dismisses it: a screen of zeroes with no next action is what it
  // exists to prevent.
  const showWelcome =
    signupLink !== null && !onboarding.welcomeDismissedAt && setup.affiliateCount === 0;

  // What the tiles compare against, said the way the picker says it, so
  // "vs last 30 days" under a figure is the same words as the choice above.
  const against = range === "all" ? "" : rangeLabel(range).toLowerCase().replace(/^last /, "previous ").replace(/^this /, "previous ").replace(/^today$/, "yesterday").replace(/^yesterday$/, "the day before");
  const revenueNow = currency ? (metrics.current.amounts[currency]?.gross ?? 0) : 0;
  const revenueBefore = currency ? metrics.previous?.amounts[currency]?.gross : null;
  const delta = (now: number, before: number | null | undefined) =>
    range === "all" ? undefined : { percent: change(now, before ?? 0), against };

  const attention = [
    payableTotal > 0 && {
      icon: Wallet,
      title: payableTotal === 1 ? "1 commission is payable" : `${formatCount(payableTotal)} commissions are payable`,
      detail: "Pay them and mark them paid",
      href: `/dashboard/products/${merchant.slug}/commissions?status=PAYABLE`,
    },
    metrics.flagged > 0 && {
      icon: ShieldAlert,
      title:
        metrics.flagged === 1
          ? "1 commission looks like a self referral"
          : `${formatCount(metrics.flagged)} commissions look like self referrals`,
      detail: "Confirm or dismiss each one",
      href: `/dashboard/products/${merchant.slug}/commissions?status=FLAGGED`,
      urgent: true,
    },
  ].filter((item): item is Exclude<typeof item, false> => Boolean(item));

  return (
    <Page>
      <PageTitle
        title="Overview"
        subtitle={range === "all" ? "Everything since the start" : `How things went, ${rangeLabel(range).toLowerCase()}`}
        actions={<RangePicker value={range} />}
      />
      {celebrate && <TrackingVerified merchantId={merchant.id} />}
      {showWelcome && (
        <Welcome product={{ id: merchant.id, slug: merchant.slug }} link={signupLink} />
      )}

      <Tiles>
        <StatTile
          label="Clicks"
          value={formatCount(metrics.clicks)}
          series={metrics.series.map((d) => d.clicks)}
          delta={delta(metrics.clicks, metrics.previous?.clicks)}
        />
        <StatTile
          label="Sales"
          value={formatCount(metrics.conversions)}
          series={metrics.series.map((d) => d.conversions)}
          delta={delta(metrics.conversions, metrics.previous?.conversions)}
        />
        <StatTile
          label="Revenue"
          value={currency ? formatMoney(revenueNow, currency) : "0.00"}
          series={currency ? metrics.series.map((d) => d.amounts[currency]?.gross ?? 0) : undefined}
          delta={currency ? delta(revenueNow, revenueBefore) : undefined}
        />
        <StatTile
          label="Owed"
          value={money(prefer(metrics.owed, currency))}
          hint={
            payableTotal
              ? `${formatCount(payableTotal)} payable now`
              : (moneyHint(prefer(metrics.owed, currency)) ?? "Nothing waiting")
          }
          href={`/dashboard/products/${merchant.slug}/commissions?status=PAYABLE`}
        />
      </Tiles>

      {!empty && (
        <div className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
          <Section
            title="Clicks and revenue"
            actions={<CurrencyPicker value={currency ?? ""} options={metrics.currencies} />}
            className="min-h-[300px]"
            fill
          >
            <ActivityChart
              points={metrics.series}
              bucket={metrics.bucket}
              currency={currency}
              barLabel="Revenue"
              countLabel="Sales"
              splitLabel="Commission"
            />
          </Section>
          <TopAffiliates
            affiliates={top}
            currency={currency}
            viewAllHref={`/dashboard/products/${merchant.slug}/affiliates`}
            className="min-h-[300px] lg:min-h-0"
          />
        </div>
      )}

      <Attention items={attention} />

      {empty && (
        <Section>
          <div className="flex items-center gap-3 text-sm">
            <Light result={{ ok: setup.trackingStatus !== "not-started", detail: "" }} label="Tracking" />
            <span className="text-muted-foreground">
              {setup.trackingStatus === "not-started" ? "no clicks yet" : "waiting for a first sale"}
            </span>
          </div>
        </Section>
      )}
    </Page>
  );
}
