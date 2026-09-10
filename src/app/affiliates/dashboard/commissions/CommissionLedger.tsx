import { Coins } from "lucide-react";
import type { AffiliateCommissionRow, AffiliateCommissionStatus } from "@/lib/affiliate";
import { voidReasonText } from "@/lib/commissionReason";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Every commission the affiliate has, whatever state it is in.
 *
 * The owner's ledger, minus what an affiliate cannot act on, and on the same
 * treatment down to the header band, the row rule and the weight of the amount
 * (src/app/dashboard/products/[product]/commissions/CommissionTable.tsx). The
 * two sides of the product are one product.
 *
 * `table-fixed` with a percentage per column: under auto layout a `max-width`
 * on a cell is ignored, so one long reason would widen the table past its card
 * instead of laying out inside it. Below `md` the table gives way to a stacked
 * list of the same rows, because five columns in the width of a phone is not a
 * table.
 */

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

// FLAGGED never reaches an affiliate: toDisplayStatus folds it into PENDING
// before a row gets here, so there are four states, not five. Locked to the
// owner's own mapping, so one colour means one thing on both sides.
export const STATUS_STYLES: Record<AffiliateCommissionStatus, string> = {
  PENDING: "bg-muted text-muted-foreground",
  PAYABLE: "bg-accent-50 text-accent-700",
  PAID: "bg-status-success-bg text-status-success",
  VOIDED: "bg-muted text-muted-foreground line-through",
};

export const STATUS_LABELS: Record<AffiliateCommissionStatus, string> = {
  PENDING: "Pending",
  PAYABLE: "Payable",
  PAID: "Paid",
  VOIDED: "Voided",
};

export type LedgerRow = {
  id: string;
  /** Formatted on the server, so every screen shows the same date. */
  dateLabel: string;
  /** Carries its currency, since amounts are never converted. */
  amount: string;
  /** What the commission was before a partial refund reduced it. Null when unchanged. */
  grossAmount: string | null;
  status: AffiliateCommissionStatus;
  linkCode: string | null;
  /** A negative clawback row netting against a refund, not new money. */
  isAdjustment: boolean;
  /** When the money arrives. The first thing an affiliate asks a row. */
  stateLabel: string;
  /** Internal token, rendered through `voidReasonText`. Never printed raw. */
  voidReason: string | null;
  /** When a voided commission was voided. */
  voidedLabel: string | null;
};

/**
 * When the money arrives.
 *
 * Only ever the good half of the story: why a row was voided or reduced comes
 * from `voidReasonText`, which is the one place that turns a stored token into
 * words.
 */
export function commissionStateLabel(row: AffiliateCommissionRow): string {
  switch (row.status) {
    case "PENDING": {
      // FLAGGED folds into PENDING and the sweep deliberately never promotes a
      // flagged row, so its payableAt can sit in the past indefinitely. Once
      // that date has passed, naming it reads as a bug ("Clears 14 Aug" in
      // September); this is honest for a row waiting on the next sweep and for
      // a concealed flagged one alike.
      if (row.payableAt.getTime() <= Date.now()) return "Clearing shortly";
      return `Clears ${DATE.format(row.payableAt)}`;
    }
    case "PAYABLE":
      return row.isAdjustment ? "Comes off your next payout" : "Ready to pay";
    case "PAID":
      return row.paidAt ? `Paid ${DATE.format(row.paidAt)}` : "Paid";
    case "VOIDED":
      // The cause is the detail column's whole job here, so the state label
      // stands in only for a row whose reason was never recorded.
      return "Voided";
  }
}

/** One database row as the ledger shows it. Both screens map through this. */
export function toLedgerRow(row: AffiliateCommissionRow): LedgerRow {
  const currency = row.currency.toUpperCase();
  return {
    id: row.id,
    dateLabel: DATE.format(row.createdAt),
    amount: `${row.amount} ${currency}`,
    grossAmount: row.grossAmount ? `${row.grossAmount} ${currency}` : null,
    status: row.status,
    linkCode: row.linkCode,
    isAdjustment: row.isAdjustment,
    stateLabel: commissionStateLabel(row),
    voidReason: row.voidReason,
    voidedLabel: row.voidedAt ? DATE.format(row.voidedAt) : null,
  };
}

/**
 * What a voided row says: the cause, then when it happened, the same
 * `cause · date` shape the owner's ledger uses. A row that carries no reason
 * says only that it was voided rather than inventing one.
 */
function voidedDetail(cause: string | null, when: string | null): string {
  if (cause && when) return `${cause} · ${when}`;
  return cause ?? (when ? `Voided ${when}` : "Voided");
}

/**
 * The three things every rendering of a row asks it. `voidReasonText` is the
 * one place a stored token becomes words, so both the table and the phone list
 * go through it rather than writing their own.
 */
function readRow(row: LedgerRow): { voided: boolean; cause: string | null; reduced: boolean } {
  const voided = row.status === "VOIDED";
  return {
    voided,
    cause: voidReasonText(row.voidReason, "affiliate"),
    reduced: !voided && row.grossAmount !== null,
  };
}

export function CommissionLedger({ rows, filtered }: { rows: LedgerRow[]; filtered: boolean }) {
  if (rows.length === 0) {
    return filtered ? (
      <EmptyState icon={<Coins />} title="Nothing matches" body="Pick another filter to see more." />
    ) : (
      <EmptyState
        icon={<Coins />}
        title="No commissions yet"
        body="A sale from one of your links shows up here the same day it happens."
      />
    );
  }

  return (
    <>
      {/* A phone is where an affiliate reads this, and five columns in 310px is
          not a table, it is overlapping text. Same row, stacked: what it is
          worth and what happened to it, in the same type and the same colours
          the table uses. */}
      <ul className="divide-y divide-neutral-200 md:hidden">
        {rows.map((row) => {
          const { voided, cause, reduced } = readRow(row);
          return (
            <li
              key={row.id}
              className={cn("flex flex-col gap-1 px-4 py-3", voided && "text-muted-foreground")}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-muted-foreground tabular-nums">
                  {row.dateLabel}
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span
                    className={cn(
                      "font-mono text-[15px] font-semibold whitespace-nowrap tabular-nums",
                      row.isAdjustment && "text-destructive",
                      !row.isAdjustment && !voided && "text-neutral-900"
                    )}
                  >
                    {row.amount}
                  </span>
                  {reduced && row.grossAmount && (
                    <span className="font-mono text-[11px] text-neutral-500 line-through tabular-nums">
                      {row.grossAmount}
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <Badge className={cn("shrink-0", STATUS_STYLES[row.status])}>
                  {STATUS_LABELS[row.status]}
                </Badge>
                <span className="min-w-0 flex-1 text-[13px] text-pretty text-muted-foreground">
                  {voided ? voidedDetail(cause, row.voidedLabel) : row.stateLabel}
                  {reduced && cause && (
                    <span className="block text-xs text-muted-foreground/70">{cause}</span>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <Table className="hidden table-fixed md:table">
        {/* The header band, hairline dividers and row padding mirror TaskCard's
            neutral bands: a header row introduces the rows under it rather than
            blending into them. */}
        <TableHeader className="sticky top-0 z-10 bg-neutral-100">
          <TableRow className="border-neutral-200 hover:bg-transparent">
            <TableHead className="h-9 w-[13%] px-4 text-[13px] font-semibold text-neutral-700">
              Date
            </TableHead>
            <TableHead className="h-9 w-[18%] px-4 text-right text-[13px] font-semibold text-neutral-700">
              Amount
            </TableHead>
            <TableHead className="h-9 w-[13%] px-4 text-[13px] font-semibold text-neutral-700">
              Status
            </TableHead>
            <TableHead className="h-9 w-[16%] px-4 text-[13px] font-semibold text-neutral-700">
              Link
            </TableHead>
            <TableHead className="h-9 w-[40%] px-4 text-[13px] font-semibold text-neutral-700">
              Detail
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="divide-y divide-neutral-200">
        {rows.map((row) => {
          const { voided, cause, reduced } = readRow(row);
          return (
            <TableRow
              key={row.id}
              className={cn(
                "border-neutral-200 hover:bg-neutral-50",
                // Muted throughout, not only on the badge: a voided sale is the
                // least important row on the screen and should read that way
                // before the eye reaches the status column.
                voided && "text-muted-foreground"
              )}
            >
              <TableCell className="px-4 py-3 align-top whitespace-nowrap text-muted-foreground tabular-nums">
                {row.dateLabel}
              </TableCell>
              <TableCell className="px-4 py-3 text-right align-top">
                {/* The heaviest thing in the row: this screen's whole subject
                    is money, and the currency is carried once, on the figure
                    itself. */}
                <span
                  className={cn(
                    "block font-mono text-[15px] font-semibold whitespace-nowrap tabular-nums",
                    row.isAdjustment && "text-destructive",
                    !row.isAdjustment && !voided && "text-neutral-900"
                  )}
                >
                  {row.amount}
                </span>
                {/* What it was before the refund, struck through under what it
                    is now: a reduced row has to show both figures or the
                    affiliate is left doing the subtraction. */}
                {reduced && row.grossAmount && (
                  <span className="block font-mono text-[11px] text-neutral-500 line-through tabular-nums">
                    {row.grossAmount}
                  </span>
                )}
              </TableCell>
              <TableCell className="hidden px-4 py-3 align-top md:table-cell">
                <Badge className={STATUS_STYLES[row.status]}>{STATUS_LABELS[row.status]}</Badge>
              </TableCell>
              <TableCell className="hidden px-4 py-3 align-top md:table-cell">
                <span className="block truncate font-mono text-[13px] text-muted-foreground">
                  {row.linkCode ?? "Deleted"}
                </span>
              </TableCell>
              <TableCell className="px-4 py-3 align-top">
                {/* Never truncated. The reason money moved is the one string on
                    this screen an affiliate cannot be asked to guess at. */}
                <span className="block text-[13px] text-pretty text-muted-foreground">
                  {voided ? voidedDetail(cause, row.voidedLabel) : row.stateLabel}
                </span>
                {reduced && cause && (
                  <span className="block text-xs text-pretty text-muted-foreground/70">{cause}</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
        </TableBody>
      </Table>
    </>
  );
}
