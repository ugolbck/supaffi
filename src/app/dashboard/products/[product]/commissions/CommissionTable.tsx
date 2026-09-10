import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Coins } from "lucide-react";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { cn } from "@/lib/utils";
import type { CommissionStatus } from "@/lib/commission";

/**
 * The ledger. Every commission, whatever state it is in, one row each.
 *
 * A row is a link to `?commission=<id>` with the current tab and filters kept,
 * so reading one is a navigation the back button undoes and a URL that can be
 * sent to somebody else. The actions moved into that sheet: they used to sit
 * in the row, which meant the table had to be a client component holding a
 * selection, and paying was a thing you did without ever reading the sale.
 */

export type LedgerRow = {
  id: string;
  /** Already carries its currency, since amounts are never converted. */
  amount: string;
  status: CommissionStatus;
  affiliateName: string | null;
  affiliateEmail: string;
  /** A negative clawback row for a refund that landed after payout. */
  isAdjustment: boolean;
  /** Formatted on the server, so the row and the sheet read the same date. */
  createdLabel: string;
  stateLabel: string;
  reference: string | null;
  /** The list URL with this commission selected. */
  href: string;
};

// Locked 1:1 to Commission.status in the design system: a scan of the color
// alone has to say the state before the label is read. PAYABLE reads accent,
// PAID reads success green, and VOIDED stays muted with the badge struck
// through rather than alarming red, since it means "does not count" rather
// than "something went wrong."
const STATUS_STYLES: Record<CommissionStatus, string> = {
  PENDING: "bg-muted text-muted-foreground",
  PAYABLE: "bg-accent-50 text-accent-700",
  FLAGGED: "bg-status-warning-bg text-status-warning",
  PAID: "bg-status-success-bg text-status-success",
  VOIDED: "bg-muted text-muted-foreground line-through",
};

const STATUS_LABELS: Record<CommissionStatus, string> = {
  PENDING: "Pending",
  PAYABLE: "Payable",
  FLAGGED: "Flagged",
  PAID: "Paid",
  VOIDED: "Voided",
};

export function CommissionTable({
  rows,
  selectedId,
  filtered,
}: {
  rows: LedgerRow[];
  /** The commission the sheet is open on, if any. */
  selectedId: string | null;
  /** Whether a tab or a filter is narrowing the view, which changes what empty means. */
  filtered: boolean;
}) {
  if (rows.length === 0) {
    // The card is flush, so an empty state brings the padding the rows carry.
    return (
      <div className="flex h-full flex-col">
        {filtered ? (
          <EmptyState icon={<Coins />} title="Nothing matches" body="Widen the filters to see more." />
        ) : (
          <EmptyState
            icon={<Coins />}
            title="No commissions yet"
            body="The first referred sale shows up here the moment Stripe reports it."
          />
        )}
      </div>
    );
  }

  return (
    <Table>
      {/* The header band, hairline dividers and row padding mirror TaskCard's
          neutral bands: a header row introduces the rows under it rather than
          blending into them. */}
      <TableHeader className="sticky top-0 z-10 bg-neutral-100">
        <TableRow className="border-neutral-200 hover:bg-transparent">
          <TableHead className="h-9 px-4 text-[13px] font-semibold text-neutral-700">Date</TableHead>
          <TableHead className="h-9 px-4 text-[13px] font-semibold text-neutral-700">Name</TableHead>
          <TableHead className="h-9 px-4 text-right text-[13px] font-semibold text-neutral-700">
            Amount
          </TableHead>
          <TableHead className="h-9 px-4 text-[13px] font-semibold text-neutral-700">Status</TableHead>
          <TableHead className="h-9 px-4 text-[13px] font-semibold text-neutral-700">Detail</TableHead>
          <TableHead className="h-9 px-4 text-right text-[13px] font-semibold text-neutral-700">
            Sale
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className="divide-y divide-neutral-200">
        {rows.map((row) => {
          const voided = row.status === "VOIDED";
          return (
            <TableRow
              key={row.id}
              data-state={row.id === selectedId ? "selected" : undefined}
              className={cn(
                "relative border-neutral-200 hover:bg-neutral-50 data-[state=selected]:bg-accent-50",
                // Muted throughout, not only on the badge: a voided sale is
                // the least important row on the screen and should read that
                // way before the eye reaches the status column.
                voided && "text-muted-foreground"
              )}
            >
              <TableCell className="px-4 py-3 whitespace-nowrap tabular-nums text-muted-foreground">
                {/* One link, stretched over the row by its own overlay: a table
                    row cannot be an anchor, and a click handler would put the
                    whole ledger back on the client. */}
                <Link href={row.href} className="cursor-pointer after:absolute after:inset-0">
                  {row.createdLabel}
                </Link>
              </TableCell>
              <TableCell className="max-w-48 px-4 py-3">
                <span className="block truncate font-medium">
                  {row.affiliateName ?? row.affiliateEmail}
                </span>
              </TableCell>
              <TableCell className="px-4 py-3 text-right">
                {/* The heaviest thing in the row: this page's whole subject
                    is money, and the currency is carried once, on the figure
                    itself, never repeated per line. */}
                <span
                  className={cn(
                    "font-mono text-[15px] font-semibold whitespace-nowrap tabular-nums",
                    row.isAdjustment && "text-destructive",
                    !row.isAdjustment && !voided && "text-neutral-900"
                  )}
                >
                  {row.amount}
                </span>
              </TableCell>
              <TableCell className="px-4 py-3">
                <Badge className={STATUS_STYLES[row.status]}>{STATUS_LABELS[row.status]}</Badge>
              </TableCell>
              <TableCell className="max-w-56 px-4 py-3">
                <span className="block truncate text-sm text-muted-foreground">{row.stateLabel}</span>
              </TableCell>
              <TableCell className="max-w-32 px-4 py-3 text-right">
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {row.reference ?? ""}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
