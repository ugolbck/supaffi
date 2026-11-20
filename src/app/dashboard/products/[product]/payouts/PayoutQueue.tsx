"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Download } from "lucide-react";
import type { ShownCommission } from "@/lib/commission";
import { MAX_NOTE, MAX_REFERENCE, MAX_SHOWN } from "@/lib/payoutLimits";
import { formatCount, formatMoney } from "@/lib/format";
import {
  countPayable,
  currenciesOf,
  paypalFile,
  wiseFile,
  PAYPAL_MAX_ROWS,
  WISE_MAX_ROWS,
  type FilePayout,
} from "@/lib/payoutFiles";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field } from "@/components/Field";
import { Term } from "@/components/Term";
import { CopyValue } from "@/components/CopyValue";
import { markPayoutsPaidAction } from "./payoutActions";

/**
 * The payouts waiting on the Owner, ticked and paid together: download the
 * file PayPal or Wise takes for the ticked rows, send it there, then mark them
 * paid with the transfer's reference.
 *
 * Each row binds the exact commissions and amounts read when the page was
 * drawn, never a re-query at write time, so a commission that clears its hold
 * between paint and click is not swept in.
 */

export type QueueRow = FilePayout & {
  commissions: ShownCommission[];
  /** Set on a balance below its minimum payout, two decimals. */
  minimum: string | null;
};

const HEAD = "h-9 text-[13px] font-medium text-neutral-700";

function key(row: QueueRow): string {
  return `${row.affiliateId}:${row.currency}`;
}

function totalsText(rows: QueueRow[]): string {
  const sums = new Map<string, number>();
  for (const row of rows) sums.set(row.currency, (sums.get(row.currency) ?? 0) + Number(row.total));
  return [...sums].map(([currency, sum]) => formatMoney(sum.toFixed(2), currency)).join(" + ");
}

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="cursor-pointer" disabled={pending}>
      Mark paid
    </Button>
  );
}

export function PayoutQueue({
  rows,
  product,
  view,
  renderedAt,
  merchantName,
  affiliatesHref,
}: {
  rows: QueueRow[];
  product: { id: string; slug: string };
  /** The tab and filters this queue is showing, so Mark paid comes back to them. */
  view: { tab: string; currency: string | null; method: string | null };
  renderedAt: string;
  merchantName: string;
  affiliatesHref: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The rows the dialog marks paid: the ticked ones, or one row's own button.
  const [paying, setPaying] = useState<QueueRow[] | null>(null);

  const ticked = rows.filter((row) => selected.has(key(row)));
  const allTicked = rows.length > 0 && ticked.length === rows.length;
  const currencies = currenciesOf(ticked);
  const oneCurrency = currencies.length === 1;

  function toggle(row: QueueRow, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(key(row));
      else next.delete(key(row));
      return next;
    });
  }

  const date = renderedAt.slice(0, 10);
  const tooMany = ticked.reduce((n, row) => n + row.commissions.length, 0) > MAX_SHOWN;
  const paypal = countPayable(ticked, "paypal");
  const wise = countPayable(ticked, "wise");

  // Why a download button is off, or who it leaves out, in one line.
  let fileHint: string | null = null;
  if (tooMany) fileHint = `Mark at most ${formatCount(MAX_SHOWN)} commissions paid at once. Tick fewer payouts.`;
  else if (ticked.length > 0 && !oneCurrency) fileHint = "Files take one currency. Filter by currency to download one.";
  else if (ticked.length > 0 && paypal === 0 && wise === 0) fileHint = "None of these gave a PayPal or Wise email.";

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-neutral-200 px-4 py-2.5">
        <span className="mr-auto text-[13px] text-muted-foreground tabular-nums">
          {ticked.length === 0
            ? "Tick payouts to pay them together"
            : `${formatCount(ticked.length)} selected, ${totalsText(ticked)}`}
          {fileHint && <span className="block text-status-warning">{fileHint}</span>}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={!oneCurrency || paypal === 0 || paypal > PAYPAL_MAX_ROWS}
          onClick={() => {
            const file = paypalFile(ticked, `${merchantName} affiliate commissions`);
            download(`paypal-payouts-${currencies[0]}-${date}.csv`, file.csv);
          }}
        >
          <Download data-icon="inline-start" /> PayPal file{paypal > 0 && paypal < ticked.length ? ` (${formatCount(paypal)})` : ""}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={!oneCurrency || wise === 0 || wise > WISE_MAX_ROWS}
          onClick={() => {
            const file = wiseFile(ticked);
            download(`wise-payouts-${currencies[0]}-${date}.csv`, file.csv);
          }}
        >
          <Download data-icon="inline-start" /> Wise file{wise > 0 && wise < ticked.length ? ` (${formatCount(wise)})` : ""}
        </Button>
        <Button size="sm" className="cursor-pointer" disabled={ticked.length === 0 || tooMany} onClick={() => setPaying(ticked)}>
          Mark paid
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto border-t border-neutral-200">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-neutral-100">
            <TableRow className="border-neutral-200 hover:bg-transparent">
              <TableHead className="w-10 pl-4">
                <Checkbox
                  aria-label="Select all"
                  className="cursor-pointer"
                  checked={allTicked}
                  indeterminate={ticked.length > 0 && !allTicked}
                  onCheckedChange={(on) => setSelected(on ? new Set(rows.map(key)) : new Set())}
                />
              </TableHead>
              <TableHead className={HEAD}>Affiliate</TableHead>
              <TableHead className={HEAD}>Pay to</TableHead>
              <TableHead className={`${HEAD} text-right`}>Commissions</TableHead>
              <TableHead className={`${HEAD} text-right`}>Amount</TableHead>
              <TableHead className={HEAD} />
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-neutral-200">
            {rows.map((row) => (
              <TableRow
                key={key(row)}
                data-state={selected.has(key(row)) ? "selected" : undefined}
                className="border-neutral-200 hover:bg-neutral-50 data-[state=selected]:bg-accent-50"
              >
                <TableCell className="pl-4">
                  <Checkbox
                    aria-label={`Select ${row.affiliateName ?? row.affiliateEmail}`}
                    className="cursor-pointer"
                    checked={selected.has(key(row))}
                    onCheckedChange={(on) => toggle(row, on)}
                  />
                </TableCell>
                <TableCell className="max-w-56">
                  <Link
                    href={`${affiliatesHref}?affiliate=${row.affiliateId}`}
                    className="block cursor-pointer truncate font-medium hover:underline"
                  >
                    {row.affiliateName ?? row.affiliateEmail}
                  </Link>
                  {row.affiliateName && (
                    <span className="block truncate text-xs text-muted-foreground">{row.affiliateEmail}</span>
                  )}
                </TableCell>
                <TableCell className="max-w-72 text-sm">
                  {row.payoutDetails ? (
                    <CopyValue value={row.payoutDetails} />
                  ) : (
                    <span className="text-status-warning">Not given yet</span>
                  )}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {formatCount(row.commissions.length)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  <span className="block text-[15px] font-medium">{formatMoney(row.total, row.currency)}</span>
                  {row.minimum && (
                    <span className="block text-xs text-muted-foreground">
                      of {formatMoney(row.minimum, row.currency)} minimum
                    </span>
                  )}
                </TableCell>
                <TableCell className="w-px pr-4 text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() => setPaying([row])}
                  >
                    Mark paid
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={paying !== null} onOpenChange={(open) => !open && setPaying(null)}>
        <DialogContent>
          {paying && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {paying.length === 1
                    ? `Mark ${paying[0].affiliateName ?? paying[0].affiliateEmail} paid`
                    : `Mark ${formatCount(paying.length)} payouts paid`}
                </DialogTitle>
                <DialogDescription>{totalsText(paying)}</DialogDescription>
              </DialogHeader>
              <form
                action={markPayoutsPaidAction.bind(
                  null,
                  product,
                  view,
                  paying.map((row) => row.commissions),
                  renderedAt
                )}
                className="flex flex-col gap-4"
              >
                <Field
                  label={<Term tip="Shown to the affiliate with the payment.">Reference</Term>}
                  htmlFor="payout-reference"
                >
                  <Input
                    id="payout-reference"
                    name="reference"
                    maxLength={MAX_REFERENCE}
                    placeholder="Transfer or batch ID"
                    autoComplete="off"
                  />
                </Field>
                <Field label={<Term tip="Only you see it.">Note</Term>} htmlFor="payout-note">
                  <Textarea id="payout-note" name="note" maxLength={MAX_NOTE} rows={3} />
                </Field>
                <DialogFooter>
                  <SubmitButton />
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
