import { requireAffiliate } from "@/lib/affiliateAuth";
import { getAffiliateMetrics, type CurrencyTotal } from "@/lib/analytics";
import { listAffiliateCommissions, referralCounts } from "@/lib/affiliate";
import { listLinksWithStats, linkUrl } from "@/lib/affiliateLink";
import { OverviewScreen } from "./OverviewCards";

/**
 * A layout only. Everything the screen shows is rendered by `OverviewScreen`,
 * which takes it all as props.
 */

/** Enough rows to fill the card at any height the band can take. */
const RECENT_COMMISSIONS = 6;

/**
 * One list of totals from several. Money is never converted, so a total is a
 * list with one entry per currency, and adding two of them is a merge on
 * currency rather than a sum. In minor units, so the cents of two decimal
 * strings do not drift through a float.
 */
function addTotals(...lists: CurrencyTotal[][]): CurrencyTotal[] {
  const minor = new Map<string, number>();
  for (const list of lists) {
    for (const entry of list) {
      minor.set(
        entry.currency,
        (minor.get(entry.currency) ?? 0) + Math.round(Number(entry.total) * 100)
      );
    }
  }
  return [...minor.entries()]
    .map(([currency, total]) => ({ currency, total: (total / 100).toFixed(2) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export default async function AffiliateOverviewPage() {
  const { affiliateId, merchant } = await requireAffiliate();

  const [metrics, links, commissions, referrals] = await Promise.all([
    getAffiliateMetrics(affiliateId),
    listLinksWithStats(affiliateId),
    listAffiliateCommissions(affiliateId, { page: 1, pageSize: RECENT_COMMISSIONS }),
    referralCounts(affiliateId),
  ]);

  // The signup link: the one the merchant's own dashboard shows and the one in
  // every email they have had from this program.
  const primary = links.find((link) => link.isPrimary) ?? links[0] ?? null;

  return (
    <OverviewScreen
      referralUrl={primary ? linkUrl(merchant.websiteUrl, primary) : null}
      recent={commissions.rows}
      series={metrics.series}
      // Everything a void has not taken away: what is still coming plus what
      // has already landed.
      earned={addTotals(metrics.unpaid, metrics.paid)}
      pending={metrics.pending}
      payable={metrics.payable}
      paid={metrics.paid}
      referrals={referrals}
    />
  );
}
