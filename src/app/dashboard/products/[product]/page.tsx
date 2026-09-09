import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug, getOnboardingState } from "@/lib/merchant";
import { getProductSetup } from "@/lib/productSetup";
import { resumeStep, stepPath } from "@/lib/onboarding";
import { getProductMetrics, getTopAffiliates, getPayableGroups } from "@/lib/analytics";
import { shouldCelebrateTracking } from "@/lib/tracking";
import { originFor } from "@/lib/url";
import { money, moneyHint } from "@/lib/format";
import { Page, PageTitle, Tiles, Section } from "@/components/dashboard/Page";
import { StatTile } from "@/components/dashboard/StatTile";
import { Light } from "@/components/dashboard/Light";
import { BarChart } from "@/components/charts/BarChart";
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
}: {
  params: Promise<{ product: string }>;
}) {
  const { product } = await params;
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
    redirect(stepPath(merchant.slug, resumeStep(setup, null)));
  }

  const [metrics, top, payable, celebrate] = await Promise.all([
    getProductMetrics(ownerId, merchant.id),
    getTopAffiliates(ownerId, merchant.id, 5),
    getPayableGroups(ownerId, merchant.id),
    shouldCelebrateTracking(merchant.id),
  ]);

  // Commissions, not groups: the Owner pays per affiliate but is counting
  // lines on a ledger.
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

  return (
    <Page>
      <PageTitle title="Overview" subtitle="Last 30 days" />
      {celebrate && <TrackingVerified merchantId={merchant.id} />}
      {showWelcome && (
        <Welcome product={{ id: merchant.id, slug: merchant.slug }} link={signupLink} />
      )}

      <Tiles>
        <StatTile
          label="Clicks"
          value={String(metrics.clicks)}
          series={metrics.series.map((d) => d.clicks)}
        />
        <StatTile
          label="Signups"
          value={String(metrics.signups)}
          series={metrics.series.map((d) => d.signups)}
        />
        <StatTile
          label="Sales"
          value={String(metrics.conversions)}
          series={metrics.series.map((d) => d.conversions)}
        />
        <StatTile
          label="Owed"
          value={money(metrics.owed)}
          hint={payableTotal ? `${payableTotal} payable now` : moneyHint(metrics.owed)}
        />
      </Tiles>

      {!empty && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          <Section
            title="Revenue attributed"
            // The bars sum sale amounts across currencies, which is only
            // honest as a shape. The money is the header, still per currency.
            actions={
              <span className="text-sm font-medium tabular-nums">{money(metrics.revenue)}</span>
            }
            fill
          >
            <BarChart series={metrics.series} field="revenue" format={(n) => n.toFixed(2)} />
          </Section>

          <Section title="Top affiliates" scroll>
            <ul className="flex flex-col gap-2 text-sm">
              {top.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3">
                  <span className="truncate">{a.name ?? a.email}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {money(a.earned)} · {a.sales} {a.sales === 1 ? "sale" : "sales"}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}

      {(payableTotal > 0 || metrics.flagged > 0) && (
        <Section title="Needs you">
          <ul className="flex flex-col gap-2 text-sm">
            {payableTotal > 0 && (
              <li>
                <Link
                  href={`/dashboard/products/${merchant.slug}/commissions?status=PAYABLE`}
                  className="flex cursor-pointer items-center justify-between hover:underline"
                >
                  <span>
                    {payableTotal === 1
                      ? "1 commission is payable"
                      : `${payableTotal} commissions are payable`}
                  </span>
                  <span>Pay them &rsaquo;</span>
                </Link>
              </li>
            )}
            {metrics.flagged > 0 && (
              <li>
                <Link
                  href={`/dashboard/products/${merchant.slug}/commissions?status=FLAGGED`}
                  className="flex cursor-pointer items-center justify-between hover:underline"
                >
                  <span>
                    {metrics.flagged === 1
                      ? "1 commission flagged as a possible self referral"
                      : `${metrics.flagged} commissions flagged as possible self referrals`}
                  </span>
                  <span>Review &rsaquo;</span>
                </Link>
              </li>
            )}
          </ul>
        </Section>
      )}

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
