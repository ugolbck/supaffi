import Link from "next/link";
import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/dashboard/EmptyState";

/**
 * The list. A row is a link to `?affiliate=<id>` with the current filters kept,
 * so reading one is a navigation the back button undoes and a URL that can be
 * sent to somebody else. Nothing here is stateful, which is why this renders on
 * the server.
 */

export type AffiliateRowView = {
  id: string;
  name: string | null;
  email: string;
  referralCode: string;
  programName: string;
  clicks: number;
  conversions: number;
  earned: string;
  earnedHint: string | null;
  /** Already carries its percent sign. */
  rate: string;
  rateIsOverride: boolean;
  /** Formatted on the server, so the row and the sheet read the same date. */
  joined: string;
  /** The list URL with this affiliate selected. */
  href: string;
};

export function AffiliateTable({
  rows,
  selectedId,
  filtered,
  emptyAction,
}: {
  rows: AffiliateRowView[];
  /** The affiliate the sheet is open on, if any. */
  selectedId: string | null;
  /** Whether a filter is narrowing the view, which changes what empty means. */
  filtered: boolean;
  /** The thing that would fill an empty list, when nothing is filtering it. */
  emptyAction: ReactNode;
}) {
  if (rows.length === 0) {
    // The card is flush, so an empty state brings the padding the rows carry.
    return (
      <div className="px-5">
        {filtered ? (
          <EmptyState title="Nothing matches" body="Widen the filters to see more." />
        ) : (
          <EmptyState
            title="Nobody has signed up yet"
            body="Share the signup link and whoever joins shows up here."
            action={emptyAction}
          />
        )}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-elevated">
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Code</TableHead>
          <TableHead>Plan</TableHead>
          <TableHead className="text-right">Clicks</TableHead>
          <TableHead className="text-right">Sales</TableHead>
          <TableHead className="text-right">Earned</TableHead>
          <TableHead className="text-right">Rate</TableHead>
          <TableHead className="text-right">Joined</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow
            key={row.id}
            data-state={row.id === selectedId ? "selected" : undefined}
            className="relative animate-in fade-in fill-mode-both duration-300"
            style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
          >
            <TableCell className="max-w-56">
              {/* One link, stretched over the row by its own overlay: a table
                  row cannot be an anchor, and a click handler would put the
                  whole list back on the client. */}
              <Link
                href={row.href}
                className="flex min-w-0 cursor-pointer flex-col after:absolute after:inset-0"
              >
                <span className="truncate font-medium">{row.name ?? row.email}</span>
                {row.name && (
                  <span className="truncate text-xs text-muted-foreground">{row.email}</span>
                )}
              </Link>
            </TableCell>
            <TableCell className="max-w-32">
              <span className="block truncate font-mono text-xs text-muted-foreground">
                {row.referralCode}
              </span>
            </TableCell>
            <TableCell className="max-w-32">
              <span className="block truncate text-sm">{row.programName}</span>
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">{row.clicks}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{row.conversions}</TableCell>
            <TableCell className="text-right font-mono whitespace-nowrap tabular-nums">
              <span className="block">{row.earned}</span>
              {row.earnedHint && (
                <span className="block text-[11px] text-muted-foreground">{row.earnedHint}</span>
              )}
            </TableCell>
            <TableCell className="text-right font-mono whitespace-nowrap tabular-nums">
              <span className="inline-flex items-center justify-end gap-1">
                {row.rate}
                {row.rateIsOverride && (
                  <>
                    <Pencil className="size-3 text-muted-foreground" />
                    <span className="sr-only">Overrides the program default</span>
                  </>
                )}
              </span>
            </TableCell>
            <TableCell className="text-right text-sm whitespace-nowrap text-muted-foreground tabular-nums">
              {row.joined}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
