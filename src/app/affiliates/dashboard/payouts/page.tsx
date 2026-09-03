import { Wallet } from "lucide-react";
import { requireAffiliate } from "@/lib/affiliateAuth";
import { getAffiliateMetrics } from "@/lib/analytics";
import {
  getAffiliatePayoutDetails,
  listAffiliatePayments,
  type AffiliatePaymentGroup,
} from "@/lib/affiliate";
import { money, moneyHint } from "@/lib/format";
import { PageShell, PageHeader, SignalRow, Band } from "@/components/dashboard/PageGrid";
import { StatTile } from "@/components/dashboard/StatTile";
import { DashboardCard, CardEmpty } from "@/components/dashboard/DashboardCard";
import { PayoutDetailsForm } from "../PayoutDetailsForm";

/**
 * What being paid looks like when Supaffi never touches the money: the
 * three totals that answer "how much, and when", the payout details the
 * Merchant pays against, and a history that is derived rather than a ledger
 * of transfers, because no transfer runs through this product.
 */

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * One row per day a payment landed, distributed the way every other list
 * card on this dashboard is (`OverviewCards.tsx`). A day can carry more than
 * one currency, so the amount is `money()` plus `moneyHint()`, never a sum
 * across them.
 */
function PaymentRows({ payments }: { payments: AffiliatePaymentGroup[] }) {
  return (
    <ul className="flex flex-1 flex-col">
      {payments.map((payment) => (
        <li
          key={payment.paidAt.toISOString()}
          className="flex min-h-11 flex-1 items-center gap-2.5 border-b border-border/50 py-1.5 text-sm last:border-0"
        >
          <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">
            {DATE.format(payment.paidAt)}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {payment.count} commission{payment.count === 1 ? "" : "s"}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="font-mono text-sm tabular-nums">{money(payment.totals)}</span>
            {moneyHint(payment.totals) && (
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {moneyHint(payment.totals)}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function AffiliatePayoutsPage() {
  const { affiliateId, merchant } = await requireAffiliate();

  const [metrics, payoutDetails, payments] = await Promise.all([
    getAffiliateMetrics(affiliateId),
    getAffiliatePayoutDetails(affiliateId),
    listAffiliatePayments(affiliateId),
  ]);

  return (
    <PageShell>
      <PageHeader title="Payouts" />

      <SignalRow columns={3}>
        <StatTile
          label="Waiting to clear"
          value={money(metrics.pending)}
          hint={moneyHint(metrics.pending)}
        />
        <StatTile
          label="Ready to pay"
          value={money(metrics.payable)}
          hint={moneyHint(metrics.payable)}
          tone={metrics.payable.length > 0 ? "success" : "neutral"}
        />
        <StatTile label="Paid out" value={money(metrics.paid)} hint={moneyHint(metrics.paid)} />
      </SignalRow>

      <Band columns={12}>
        <PayoutDetailsForm initial={payoutDetails ?? ""} className="lg:col-span-5" />

        <DashboardCard
          title="Payment history"
          className="lg:col-span-7"
          bodyScrolls
          action={
            <span className="text-xs text-muted-foreground">Paid by {merchant.name} directly</span>
          }
        >
          {payments.length === 0 ? (
            <CardEmpty icon={Wallet} title="No payments yet." />
          ) : (
            <PaymentRows payments={payments} />
          )}
        </DashboardCard>
      </Band>
    </PageShell>
  );
}
