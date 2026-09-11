import { Wallet } from "lucide-react";
import type { AffiliatePaymentGroup } from "@/lib/affiliate";
import type { CurrencyTotal } from "@/lib/analytics";
import { money, moneyHint } from "@/lib/format";
import { Page, PageTitle, Tiles, Section } from "@/components/dashboard/Page";
import { StatTile } from "@/components/dashboard/StatTile";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { PayoutDetailsForm } from "../PayoutDetailsForm";

/**
 * What being paid looks like when Supaffi never touches the money: the three
 * totals, the details the merchant pays against, and a history that is derived
 * rather than a ledger of transfers, because no transfer runs through this
 * product.
 *
 * Presentational: the page reads the database and hands the result over, so the
 * screen can be rendered in the dev kit with fixtures.
 */

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * One row per day a payment landed. A day can carry more than one currency, so
 * the amount is `money()` plus `moneyHint()`, never a sum across them.
 */
function PaymentRows({ payments }: { payments: AffiliatePaymentGroup[] }) {
  return (
    <ul className="flex flex-col">
      {payments.map((payment) => {
        const hint = moneyHint(payment.totals);
        return (
          <li
            key={payment.paidAt.toISOString()}
            className="flex items-center gap-3 border-b border-neutral-200 py-3 last:border-0"
          >
            <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
              {DATE.format(payment.paidAt)}
            </span>
            {/* Dropped on a phone rather than truncated to nothing: it is the
                least of the three things in the row. */}
            <span className="hidden min-w-0 flex-1 truncate text-[13px] text-muted-foreground tabular-nums sm:block">
              {payment.count} commission{payment.count === 1 ? "" : "s"}
            </span>
            <span className="flex-1 sm:hidden" />
            <span className="flex shrink-0 flex-col items-end">
              <span className="font-mono text-[15px] font-semibold text-neutral-900 tabular-nums">
                {money(payment.totals)}
              </span>
              {hint && (
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {hint}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export type PayoutsView = {
  merchantName: string;
  payoutDetails: string | null;
  payments: AffiliatePaymentGroup[];
  pending: CurrencyTotal[];
  payable: CurrencyTotal[];
  paid: CurrencyTotal[];
};

export function PayoutsScreen({
  merchantName,
  payoutDetails,
  payments,
  pending,
  payable,
  paid,
}: PayoutsView) {
  return (
    <Page>
      <PageTitle title="Payouts" />

      {/* The same three words the ledger's badges use, so one state is one word
          everywhere on this dashboard. */}
      <Tiles columns={3}>
        <StatTile label="Pending" value={money(pending)} hint={moneyHint(pending)} />
        <StatTile
          label="Payable"
          value={money(payable)}
          hint={moneyHint(payable)}
          tone={payable.length > 0 ? "accent" : "neutral"}
        />
        <StatTile
          label="Paid"
          value={money(paid)}
          hint={moneyHint(paid)}
          tone={paid.length > 0 ? "success" : "neutral"}
        />
      </Tiles>

      {/* Content sized, not stretched to the viewport: two cards holding a
          textarea and a handful of dates have nothing to fill 500px with, and
          air under a page reads better than air inside a card. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PayoutDetailsForm initial={payoutDetails ?? ""} />

        <Section
          title="Payment history"
          // The one fact this screen has to carry: the money comes from the
          // merchant, not from here, so nobody waits on a transfer that is
          // never coming.
          actions={
            // Dropped on a phone: beside a title that has already wrapped it
            // reads as a cramped third column, and the empty state carries the
            // same fact where it is needed most.
            <span className="hidden text-right text-[13px] text-balance text-muted-foreground sm:block">
              Paid by {merchantName} directly
            </span>
          }
          scroll
          className="max-h-[26rem]"
        >
          {payments.length === 0 ? (
            <EmptyState
              icon={<Wallet />}
              title="No payments yet"
              body={`A payment appears here once ${merchantName} marks your commissions paid.`}
            />
          ) : (
            <PaymentRows payments={payments} />
          )}
        </Section>
      </div>
    </Page>
  );
}
