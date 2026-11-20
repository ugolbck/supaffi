import { Wallet } from "lucide-react";
import type { AffiliatePaymentGroup } from "@/lib/affiliate";
import type { CurrencyTotal } from "@/lib/analytics";
import type { Shortfall } from "@/lib/payoutMinimum";
import { methodLabel } from "@/lib/payoutMethod";
import { money, moneyHint, formatDate, formatMoney } from "@/lib/format";
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


/**
 * One row per payout, at the moment it was made. Two payouts made the same
 * day are two rows, each with its own time, because they were two transfers.
 */
function PaymentRows({ payments }: { payments: AffiliatePaymentGroup[] }) {
  return (
    <ul className="flex flex-col">
      {payments.map((payment) => {
        const sent = [methodLabel(payment.method), payment.reference].filter(Boolean).join(" · ");
        return (
          <li
            key={`${payment.paidAt.toISOString()}:${payment.currency}`}
            className="flex items-center gap-3 border-b border-neutral-200 py-3 last:border-0"
          >
            <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
              {formatDate(payment.paidAt)}
            </span>
            {/* Dropped on a phone rather than truncated to nothing: it is the
                least of the things in the row. */}
            <span className="hidden min-w-0 flex-1 flex-col sm:flex">
              <span className="truncate text-[13px] text-muted-foreground tabular-nums">
                {payment.count} commission{payment.count === 1 ? "" : "s"}
              </span>
              {sent && <span className="truncate text-[11px] text-muted-foreground">{sent}</span>}
            </span>
            <span className="flex-1 sm:hidden" />
            <span className="shrink-0 text-[15px] font-medium text-neutral-900 tabular-nums">
              {formatMoney(payment.total, payment.currency)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Why a payable balance is not being paid yet, for the first currency the tile shows. */
function minimumNote(payable: CurrencyTotal[], shortfalls: Record<string, Shortfall>): string | undefined {
  const first = payable[0];
  const shortfall = first && shortfalls[first.currency];
  return shortfall ? `Paid once it reaches ${formatMoney(shortfall.minimum, first.currency)}` : undefined;
}

export type PayoutsView = {
  merchantName: string;
  payoutDetails: string | null;
  payments: AffiliatePaymentGroup[];
  pending: CurrencyTotal[];
  payable: CurrencyTotal[];
  paid: CurrencyTotal[];
  /** Payable balances below the program's minimum payout, by currency. */
  shortfalls: Record<string, Shortfall>;
};

export function PayoutsScreen({
  merchantName,
  payoutDetails,
  payments,
  pending,
  payable,
  paid,
  shortfalls,
}: PayoutsView) {
  const payableHint = [moneyHint(payable), minimumNote(payable, shortfalls)].filter(Boolean).join("  ·  ");
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
          hint={payableHint || undefined}
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
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
