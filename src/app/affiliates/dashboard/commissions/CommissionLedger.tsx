import { Receipt } from "lucide-react";
import type { AffiliateCommissionStatus } from "@/lib/affiliate";
import { CardEmpty } from "@/components/dashboard/DashboardCard";
import { LedgerScroller, LEDGER_ROW_HEIGHT } from "@/components/dashboard/LedgerScroller";
import { Badge } from "@/components/ui/badge";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STATUS_LABELS, STATUS_STYLES } from "../OverviewCards";

export type LedgerRow = {
  id: string;
  /** Pre-formatted on the server, so the table renders the same on both sides. */
  dateLabel: string;
  amount: string;
  currency: string;
  status: AffiliateCommissionStatus;
  linkCode: string | null;
  /** A negative clawback row netting against a refund, not new money. */
  isAdjustment: boolean;
  /** When the money arrives, or what happened to it. The point of the screen. */
  whenLabel: string;
};

/**
 * Every commission the Affiliate has, whatever state it is in.
 *
 * `table-fixed` with a percentage per column, the owner ledger's fix for the
 * same bug: `max-width` on a cell is ignored under auto table layout, so a
 * long "When you get it" line would widen the table past its card instead of
 * truncating inside it (src/app/dashboard/products/[product]/commissions/CommissionTable.tsx).
 *
 * No row is interactive here, so this is a server component. The last row's
 * border follows the plain `<tbody>` resolution `LinksTable` already settled
 * on: shadcn's `TableBody` and a competing last-child border rule are the
 * same selector at the same specificity, decided by stylesheet emission order
 * rather than by anything in this file.
 */
export function CommissionLedger({ rows, filtered }: { rows: LedgerRow[]; filtered: boolean }) {
  if (rows.length === 0) {
    return (
      <CardEmpty
        icon={Receipt}
        title={filtered ? "Nothing matches this filter." : "No commissions yet."}
      />
    );
  }

  return (
    <LedgerScroller>
      <Table className="table-fixed">
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead className="w-[12%]">Date</TableHead>
            <TableHead className="w-[16%] text-right">Amount</TableHead>
            <TableHead className="w-[14%]">Status</TableHead>
            <TableHead className="w-[18%]">Link</TableHead>
            <TableHead className="w-[40%]">When you get it</TableHead>
          </TableRow>
        </TableHeader>
        <tbody data-slot="table-body">
          {rows.map((row, i) => (
            <TableRow
              key={row.id}
              className={`animate-in fade-in fill-mode-both duration-300 ${LEDGER_ROW_HEIGHT}`}
              style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
            >
              <TableCell className="truncate whitespace-nowrap text-muted-foreground">
                {row.dateLabel}
              </TableCell>
              <TableCell className="truncate text-right font-mono whitespace-nowrap tabular-nums">
                <span className={row.isAdjustment ? "text-destructive" : undefined}>
                  {row.amount} {row.currency.toUpperCase()}
                </span>
              </TableCell>
              <TableCell>
                <Badge className={STATUS_STYLES[row.status]}>{STATUS_LABELS[row.status]}</Badge>
              </TableCell>
              <TableCell className={`truncate ${row.linkCode ? "" : "text-muted-foreground"}`}>
                {row.linkCode ?? "Deleted"}
              </TableCell>
              <TableCell className="truncate text-muted-foreground">{row.whenLabel}</TableCell>
            </TableRow>
          ))}
        </tbody>
      </Table>
    </LedgerScroller>
  );
}
