import type { AffiliateCommissionRow, AffiliateCommissionStatus } from "@/lib/affiliate";
import type { AffiliateLinkStats } from "@/lib/affiliateLink";
import type { CurrencyTotal } from "@/lib/analytics";
import { money, moneyHint } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

/**
 * The three list bodies the Overview cards are built from.
 *
 * Split out of the page so the page stays a layout: what fetches, what goes in
 * which cell, and which card is empty. The row treatment itself is the owner
 * overview's, verbatim, so both dashboards read the same.
 */

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// FLAGGED never reaches an Affiliate: toDisplayStatus folds it into PENDING
// before a row gets here, so there are four states, not five.
const STATUS_STYLES: Record<AffiliateCommissionStatus, string> = {
  PENDING: "bg-muted text-muted-foreground",
  PAYABLE: "bg-status-success-bg text-status-success",
  PAID: "bg-accent-100 text-accent-800",
  VOIDED: "bg-muted text-muted-foreground line-through",
};

const STATUS_LABELS: Record<AffiliateCommissionStatus, string> = {
  PENDING: "Pending",
  PAYABLE: "Payable",
  PAID: "Paid",
  VOIDED: "Voided",
};

/** When the money arrives, which is the first thing an Affiliate asks a row. */
function stateLabel(row: AffiliateCommissionRow): string {
  switch (row.status) {
    case "PENDING":
      return `Clears ${DATE.format(row.payableAt)}`;
    case "PAYABLE":
      return "Ready to pay";
    case "PAID":
      return row.paidAt ? `Paid ${DATE.format(row.paidAt)}` : "Paid";
    case "VOIDED":
      return "Voided, refunded";
  }
}

/**
 * Rows share the card's height rather than stacking at the top, ruled between,
 * which is what keeps these cards full at one row as well as at ten.
 */
export function LinkRows({ links }: { links: AffiliateLinkStats[] }) {
  return (
    <ul className="flex flex-1 flex-col">
      {links.map((link) => (
        <li
          key={link.id}
          className="flex min-h-11 flex-1 items-center gap-2.5 border-b border-border/50 py-1.5 text-sm last:border-0"
        >
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{link.code}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {link.clicks} clk
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums">{money(link.earned)}</span>
        </li>
      ))}
    </ul>
  );
}

export function CommissionRows({ rows }: { rows: AffiliateCommissionRow[] }) {
  return (
    <ul className="flex flex-1 flex-col">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex min-h-11 flex-1 items-center gap-2.5 border-b border-border/50 py-1.5 text-sm last:border-0"
        >
          <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">
            {DATE.format(row.createdAt)}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {stateLabel(row)}
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums">
            {row.amount} {row.currency.toUpperCase()}
          </span>
          <Badge className={STATUS_STYLES[row.status]}>{STATUS_LABELS[row.status]}</Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * What is on file, and what is waiting on it.
 *
 * The details are freeform text a Merchant pays against, so they get the height
 * of the card rather than a truncated line, and the payable total sits above
 * them because that is the money those details are for.
 */
export function PayoutSummary({
  details,
  payable,
}: {
  details: string;
  payable: CurrencyTotal[];
}) {
  const hint = moneyHint(payable);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-border/50 pb-2.5">
        <span className="text-xs font-medium text-muted-foreground">Ready to pay</span>
        <span className="flex flex-col items-end gap-0.5">
          <span
            className={`font-mono text-sm tabular-nums ${
              payable.length > 0 ? "text-status-success" : "text-muted-foreground"
            }`}
          >
            {money(payable)}
          </span>
          {hint && (
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{hint}</span>
          )}
        </span>
      </div>
      <p className="min-h-0 flex-1 overflow-y-auto rounded-(--radius-lg) bg-muted/50 p-2.5 font-mono text-xs break-words whitespace-pre-wrap">
        {details}
      </p>
    </div>
  );
}
