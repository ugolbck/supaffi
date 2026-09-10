import Link from "next/link";
import type { AffiliateCommissionRow } from "@/lib/affiliate";
import { cn } from "@/lib/utils";
import type { CurrencyTotal, DayPoint } from "@/lib/analytics";
import { money, moneyHint } from "@/lib/format";
import { Page, PageTitle, Tiles, Section } from "@/components/dashboard/Page";
import { StatTile } from "@/components/dashboard/StatTile";
import { BarChart } from "@/components/charts/BarChart";
import { CopyField } from "@/components/onboarding/CodeBlock";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, STATUS_STYLES, toLedgerRow } from "./commissions/CommissionLedger";

/**
 * The affiliate's own dashboard: the link they came for, what they have
 * earned, and what is on its way.
 *
 * Presentational on purpose. The page reads the database and hands the whole
 * screen over as props, so it can be read in the dev kit with fixtures.
 *
 * Four figures, no more. Clicks and sales are the chart's job, and a fifth
 * tile computed from the first four ("rate") is arithmetic on screen rather
 * than something to act on.
 */

export type OverviewView = {
  /** The signup link, already built into a shareable URL. */
  referralUrl: string | null;
  recent: AffiliateCommissionRow[];
  series: DayPoint[];
  earned: CurrencyTotal[];
  pending: CurrencyTotal[];
  payable: CurrencyTotal[];
  paid: CurrencyTotal[];
  /** Counts only. Which customers they are is never the affiliate's to see. */
  referrals: { total: number; active: number };
};

/**
 * How many of the customers this affiliate brought in are still paying.
 *
 * A recurring program lives or dies on this number, and it is the one thing
 * the ledger cannot show: a commission that stopped arriving looks exactly
 * like a quiet month.
 */
function Referrals({ total, active }: { total: number; active: number }) {
  const share = total === 0 ? 0 : active / total;

  return (
    <div className="flex flex-1 flex-col justify-center gap-3">
      <div className="flex flex-col gap-1">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[32px] leading-none font-semibold tracking-tight tabular-nums">
            {active}
          </span>
          {total > 0 && (
            <span className="text-[15px] text-muted-foreground tabular-nums">of {total}</span>
          )}
        </span>
        <span className="text-[13px] text-muted-foreground">
          {total === 0 ? "No referred customers yet" : "still paying"}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        {share > 0 && (
          <div
            className="h-full rounded-full bg-accent-500"
            style={{ width: `${Math.max(4, Math.round(share * 100))}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function OverviewScreen({
  referralUrl,
  recent,
  series,
  earned,
  pending,
  payable,
  paid,
  referrals,
}: OverviewView) {
  // Through the ledger's own mapping, so a date and an amount read the same on
  // this card as they do on the ledger the card links to.
  const recentRows = recent.map(toLedgerRow);

  return (
    <Page>
      <PageTitle title="Overview" />

      {/* The thing they came for, at the top and on the copy treatment every
          value in the product is copied from. Not a row in a table. */}
      {referralUrl && (
        <div className="flex shrink-0 flex-col gap-1.5">
          <span className="text-[13px] font-medium text-neutral-700">Your link</span>
          <CopyField value={referralUrl} />
        </div>
      )}

      <Tiles>
        <StatTile label="Earned" value={money(earned)} hint={moneyHint(earned)} />
        <StatTile label="Pending" value={money(pending)} hint={moneyHint(pending)} />
        <StatTile
          label="Payable"
          value={money(payable)}
          hint={moneyHint(payable)}
          tone={payable.length > 0 ? "success" : "neutral"}
        />
        <StatTile label="Paid" value={money(paid)} hint={moneyHint(paid)} />
      </Tiles>

      {/* One band, the shape the owner's own overview uses: the wide chart, and
          a rail of what it turned into. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        {/* A chart draws into the height it is given, and on a phone the band
            is a stacked column with no height to give, so it gets a floor. */}
        <Section
          title="Clicks and sales"
          actions={<span className="text-[13px] text-muted-foreground">Last 30 days</span>}
          className="min-h-[240px] lg:min-h-0"
          fill
        >
          {/* No empty branch: the series is zero filled, so a brand new
              affiliate gets thirty flat bars rather than an empty box. */}
          <BarChart series={series} />
        </Section>

        <div className="grid gap-4 lg:min-h-0 lg:grid-rows-[auto_1fr]">
          <Section title="Referrals">
            <Referrals total={referrals.total} active={referrals.active} />
          </Section>

          <Section
            scroll
            title="Recent commissions"
            actions={
              <Link
                href="/affiliates/dashboard/commissions"
                className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground"
              >
                All
              </Link>
            }
          >
            {recentRows.length === 0 ? (
              <p className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
                Nothing yet
              </p>
            ) : (
              <ul className="flex flex-col">
                {recentRows.map((row) => (
                  // Date, then state, then the figure hard against the right
                  // edge: the amounts line up as a column, which is the only
                  // arrangement of the three that lets them be compared.
                  <li
                    key={row.id}
                    className="flex items-center gap-2.5 border-b border-neutral-200 py-2.5 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground tabular-nums">
                      {row.dateLabel}
                    </span>
                    <Badge className={cn("shrink-0", STATUS_STYLES[row.status])}>
                      {STATUS_LABELS[row.status]}
                    </Badge>
                    <span
                      className={cn(
                        "shrink-0 text-right font-mono text-[13px] font-semibold tabular-nums",
                        row.isAdjustment ? "text-destructive" : "text-neutral-900",
                        row.status === "VOIDED" && "font-normal text-muted-foreground"
                      )}
                    >
                      {row.amount}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </Page>
  );
}
