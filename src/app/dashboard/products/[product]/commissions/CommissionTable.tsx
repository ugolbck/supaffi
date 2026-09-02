"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CommissionStatus } from "@/lib/commission";
import { LedgerScroller, LEDGER_ROW_HEIGHT } from "@/components/dashboard/LedgerScroller";
import { ConfirmFraudButton } from "./ConfirmFraudButton";
import { DismissFlagButton } from "./DismissFlagButton";
import { markPaidAction } from "./markPaid";

/**
 * Every commission in one table, whatever state it is in.
 *
 * Paying out used to be a row-level button on a pre-grouped list. It is a
 * selection here instead, which keeps the rule that matters: the write names
 * the exact ids the Owner was looking at, never a re-query that could sweep in
 * a commission that turned payable in between (see CONTEXT.md).
 */

export type LedgerRow = {
  id: string;
  amount: string;
  currency: string;
  status: CommissionStatus;
  affiliateId: string;
  affiliateName: string | null;
  affiliateEmail: string;
  stripePaymentRef: string | null;
  isAdjustment: boolean;
  /** Pre-formatted on the server, so the table renders the same on both sides. */
  createdLabel: string;
  stateLabel: string;
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
  merchantId,
  rows,
  filtered,
}: {
  merchantId: string;
  rows: LedgerRow[];
  /** Whether any filter is narrowing the view, which changes what empty means. */
  filtered: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const payable = useMemo(() => rows.filter((r) => r.status === "PAYABLE"), [rows]);
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);

  // A payout covers one affiliate in one currency. Spanning either is not a
  // payout, so the bar says so rather than letting the action fail on submit.
  const groups = new Set(selectedRows.map((r) => `${r.affiliateId}:${r.currency}`));
  const oneGroup = groups.size === 1;
  const total = selectedRows.reduce((sum, r) => sum + Number(r.amount), 0);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (rows.length === 0) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>{filtered ? "Nothing matches" : "No commissions yet"}</EmptyTitle>
          <EmptyDescription>
            {filtered
              ? "Widen the filters to see more."
              : "The first referred sale shows up here the moment Stripe reports it."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-1 flex-col lg:min-h-0">
      <LedgerScroller>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="w-9">
                {payable.length > 0 && (
                  <Checkbox
                    aria-label="Select every payable commission on this page"
                    checked={selected.size > 0 && selected.size === payable.length}
                    onCheckedChange={(checked) =>
                      setSelected(checked ? new Set(payable.map((r) => r.id)) : new Set())
                    }
                  />
                )}
              </TableHead>
              <TableHead>Affiliate</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Earned</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow
                key={row.id}
                data-state={selected.has(row.id) ? "selected" : undefined}
                className={`animate-in fade-in fill-mode-both duration-300 ${LEDGER_ROW_HEIGHT}`}
                style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
              >
                <TableCell>
                  {row.status === "PAYABLE" && (
                    <Checkbox
                      aria-label={`Select commission for ${row.affiliateEmail}`}
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggle(row.id)}
                    />
                  )}
                </TableCell>
                <TableCell className="max-w-56">
                  <div className="flex flex-col">
                    <span className="truncate font-medium">
                      {row.affiliateName ?? row.affiliateEmail}
                    </span>
                    {row.affiliateName && (
                      <span className="truncate text-xs text-muted-foreground">
                        {row.affiliateEmail}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono whitespace-nowrap tabular-nums">
                  <span className={row.isAdjustment ? "text-destructive" : undefined}>
                    {row.amount} {row.currency.toUpperCase()}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge className={STATUS_STYLES[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {row.createdLabel}
                </TableCell>
                <TableCell className="max-w-64">
                  <div className="flex flex-col">
                    <span className="truncate text-sm text-muted-foreground">{row.stateLabel}</span>
                    {row.stripePaymentRef && (
                      <span className="truncate font-mono text-[11px] text-muted-foreground/70">
                        {row.stripePaymentRef}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {row.status === "FLAGGED" && (
                    <div className="flex justify-end gap-2">
                      <DismissFlagButton merchantId={merchantId} commissionId={row.id} />
                      <ConfirmFraudButton merchantId={merchantId} commissionId={row.id} />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </LedgerScroller>

      {selected.size > 0 && (
        <div className="flex shrink-0 animate-in flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-elevated px-4 py-3 slide-in-from-bottom-2 duration-200 ease-[var(--ease-out)]">
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <span className="font-medium tabular-nums">
              {selected.size} selected
            </span>
            {oneGroup ? (
              <span className="font-mono text-muted-foreground tabular-nums">
                {total.toFixed(2)} {selectedRows[0].currency.toUpperCase()}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-status-warning">
                <AlertTriangle className="size-3.5" />
                One affiliate and one currency per payout
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              onClick={() => setSelected(new Set())}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="cursor-pointer"
              disabled={!oneGroup || isPending}
              onClick={() => {
                const ids = selectedRows.map((r) => r.id);
                startTransition(async () => {
                  const result = await markPaidAction(merchantId, ids);
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success(
                    `Marked ${result.count} commission${result.count === 1 ? "" : "s"} as paid`
                  );
                  setSelected(new Set());
                  router.refresh();
                });
              }}
            >
              Mark paid
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
