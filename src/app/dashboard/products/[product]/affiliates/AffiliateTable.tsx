"use client";

import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { AffiliateSheet, type AffiliateRowView } from "./AffiliateSheet";

export type { AffiliateRowView };

/**
 * The list, and the sheet it opens.
 *
 * `selectedId` outlives `open` on purpose: clearing it on close would empty
 * the sheet mid exit-transition and the panel would slide out blank.
 */
export function AffiliateTable({
  rows,
  filtered,
  emptyAction,
}: {
  rows: AffiliateRowView[];
  /** Whether a filter is narrowing the view, which changes what empty means. */
  filtered: boolean;
  /** The thing that would fill an empty list, when nothing is filtering it. */
  emptyAction: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  function openRow(id: string) {
    setSelectedId(id);
    setOpen(true);
  }

  if (rows.length === 0) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>{filtered ? "Nothing matches" : "Nobody has signed up yet"}</EmptyTitle>
          {filtered && <EmptyDescription>Widen the filters to see more.</EmptyDescription>}
        </EmptyHeader>
        {!filtered && <EmptyContent>{emptyAction}</EmptyContent>}
      </Empty>
    );
  }

  return (
    <div className="flex flex-1 flex-col lg:min-h-0">
      <div className="flex-1 overflow-y-auto lg:min-h-0">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Affiliate</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Program</TableHead>
              <TableHead className="text-right">Clicks</TableHead>
              <TableHead className="text-right">Conversions</TableHead>
              <TableHead className="text-right">Earned</TableHead>
              <TableHead className="text-right">Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow
                key={row.id}
                onClick={() => openRow(row.id)}
                data-state={row.id === selectedId && open ? "selected" : undefined}
                className="animate-in fade-in cursor-pointer fill-mode-both duration-300"
                style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
              >
                <TableCell className="max-w-56">
                  {/* The row is the target; this is the keyboard one. */}
                  <button
                    type="button"
                    className="flex min-w-0 cursor-pointer flex-col text-left"
                    onClick={(event) => {
                      event.stopPropagation();
                      openRow(row.id);
                    }}
                  >
                    <span className="truncate font-medium">{row.name ?? row.email}</span>
                    {row.name && (
                      <span className="truncate text-xs text-muted-foreground">{row.email}</span>
                    )}
                  </button>
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
                <TableCell className="text-right font-mono tabular-nums">
                  {row.conversions}
                </TableCell>
                <TableCell className="text-right font-mono whitespace-nowrap tabular-nums">
                  <span className="block">{row.earned}</span>
                  {row.earnedHint && (
                    <span className="block text-[11px] text-muted-foreground">
                      {row.earnedHint}
                    </span>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AffiliateSheet row={selected} open={open} onOpenChange={setOpen} />
    </div>
  );
}
