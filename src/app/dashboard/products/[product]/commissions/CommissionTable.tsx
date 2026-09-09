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
import { EmptyState } from "@/components/dashboard/EmptyState";
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

const STATUS_STYLES: Record<CommissionStatus, string> = {
  PENDING: "bg-muted text-muted-foreground",
  PAYABLE: "bg-status-success-bg text-status-success",
  FLAGGED: "bg-status-warning-bg text-status-warning",
  PAID: "bg-accent-100 text-accent-800",
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
      <div className="px-5">
        {filtered ? (
          <EmptyState title="Nothing matches" body="Widen the filters to see more." />
        ) : (
          <EmptyState
            title="No commissions yet"
            body="The first referred sale shows up here the moment Stripe reports it."
          />
        )}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-elevated">
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Detail</TableHead>
          <TableHead className="text-right">Sale</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            data-state={row.id === selectedId ? "selected" : undefined}
            className="relative"
          >
            <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
              {/* One link, stretched over the row by its own overlay: a table
                  row cannot be an anchor, and a click handler would put the
                  whole ledger back on the client. */}
              <Link href={row.href} className="cursor-pointer after:absolute after:inset-0">
                {row.createdLabel}
              </Link>
            </TableCell>
            <TableCell className="max-w-48">
              <span className="block truncate font-medium">
                {row.affiliateName ?? row.affiliateEmail}
              </span>
            </TableCell>
            <TableCell className="text-right font-mono whitespace-nowrap tabular-nums">
              <span className={row.isAdjustment ? "text-destructive" : undefined}>{row.amount}</span>
            </TableCell>
            <TableCell>
              <Badge className={STATUS_STYLES[row.status]}>{STATUS_LABELS[row.status]}</Badge>
            </TableCell>
            <TableCell className="max-w-56">
              <span className="block truncate text-sm text-muted-foreground">{row.stateLabel}</span>
            </TableCell>
            <TableCell className="max-w-32 text-right">
              <span className="block truncate font-mono text-xs text-muted-foreground">
                {row.reference ?? ""}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
