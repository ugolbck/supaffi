import Link from "next/link";
import { Receipt, Wallet } from "lucide-react";
import { requireAffiliate } from "@/lib/affiliateAuth";
import { getAffiliateMetrics } from "@/lib/analytics";
import { getAffiliatePayoutDetails, listAffiliateCommissions } from "@/lib/affiliate";
import { listLinksWithStats, linkUrl } from "@/lib/affiliateLink";
import { money, moneyHint } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { PageShell, PageHeader, SignalRow, Band } from "@/components/dashboard/PageGrid";
import { StatTile } from "@/components/dashboard/StatTile";
import { DashboardCard, CardEmpty } from "@/components/dashboard/DashboardCard";
import { BarChart } from "@/components/charts/BarChart";
import { LinkRows, CommissionRows, PayoutSummary } from "./OverviewCards";

/**
 * The Affiliate's own dashboard: what their links have done, what they have
 * earned, and when it arrives.
 *
 * Day one is the shape this screen is built for. An Affiliate with no clicks
 * has a flat chart rather than an empty box, a links card holding the link
 * they were given at signup, and two empty states that each carry the action
 * that fills them. Only the numbers change once traffic starts.
 */

/** Enough rows to fill the card at any card height the band can take. */
const RECENT_COMMISSIONS = 6;

export default async function AffiliateOverviewPage() {
  const { affiliateId, merchant } = await requireAffiliate();

  const [metrics, links, commissions, payoutDetails] = await Promise.all([
    getAffiliateMetrics(affiliateId),
    listLinksWithStats(affiliateId),
    listAffiliateCommissions(affiliateId, { page: 1, pageSize: RECENT_COMMISSIONS }),
    getAffiliatePayoutDetails(affiliateId),
  ]);

  // The signup link, which is the one the header offers to copy and the one an
  // empty commissions card asks the Affiliate to share.
  const primary = links.find((link) => link.isPrimary) ?? links[0] ?? null;
  const referralUrl = primary ? linkUrl(merchant.websiteUrl, primary) : null;

  // Per day conversion rate, divided at the edge the way the owner overview
  // does it: a zero click day reads as a zero rate rather than NaN.
  const rateSeries = metrics.series.map((d) =>
    d.clicks === 0 ? 0 : Math.round((d.conversions / d.clicks) * 1000) / 10
  );

  return (
    <PageShell>
      <PageHeader
        title="Overview"
        actions={
          referralUrl && (
            <CopyLinkButton size="sm" link={referralUrl} label="Copy referral link" />
          )
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
          label="Unpaid"
          value={money(metrics.unpaid)}
          hint={moneyHint(metrics.unpaid)}
          tone={metrics.unpaid.length > 0 ? "success" : "neutral"}
        />
        <StatTile label="Paid out" value={money(metrics.paid)} hint={moneyHint(metrics.paid)} />
      </SignalRow>

      <Band>
        <DashboardCard
          title="Performance"
          className="lg:col-span-8"
          action={<span className="text-xs text-muted-foreground">Last 30 days</span>}
        >
          {/* No empty branch: the series is zero filled, so a brand new
              Affiliate gets thirty flat bars rather than an empty box. */}
          <BarChart series={metrics.series} />
        </DashboardCard>

        <DashboardCard
          title="Your links"
          className="lg:col-span-4"
          bodyScrolls
          footer={
            <Link href="/affiliates/dashboard/links">
              <Button variant="outline" size="sm" className="w-full cursor-pointer">
                Manage links
              </Button>
            </Link>
          }
        >
          <LinkRows links={links} websiteUrl={merchant.websiteUrl} />
        </DashboardCard>
      </Band>

      <Band>
        <DashboardCard
          title="Recent commissions"
          className="lg:col-span-8"
          bodyPadding={commissions.rows.length === 0}
          footer={
            <Link href="/affiliates/dashboard/commissions">
              <Button variant="outline" size="sm" className="w-full cursor-pointer">
                All commissions
              </Button>
            </Link>
          }
        >
          {commissions.rows.length === 0 ? (
            <CardEmpty
              icon={Receipt}
              title="No commissions yet."
              action={referralUrl && <CopyLinkButton size="sm" link={referralUrl} />}
            />
          ) : (
            <CommissionRows rows={commissions.rows} />
          )}
        </DashboardCard>

        {payoutDetails ? (
          <DashboardCard
            title="Getting paid"
            className="lg:col-span-4"
            footer={
              <Link href="/affiliates/dashboard/payouts">
                <Button variant="outline" size="sm" className="w-full cursor-pointer">
                  Edit payout details
                </Button>
              </Link>
            }
          >
            <PayoutSummary details={payoutDetails} payable={metrics.payable} />
          </DashboardCard>
        ) : (
          // No footer in this state: the empty state already carries the one
          // action the card has, and two buttons to the same page is not a
          // fuller card, it is the same button twice.
          <DashboardCard title="Getting paid" className="lg:col-span-4">
            <CardEmpty
              icon={Wallet}
              title="No payout details yet."
              action={
                <Link href="/affiliates/dashboard/payouts">
                  <Button size="sm" className="cursor-pointer">
                    Add payout details
                  </Button>
                </Link>
              }
            />
          </DashboardCard>
        )}
      </Band>
    </PageShell>
  );
}
