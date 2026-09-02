"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { LedgerScroller, LEDGER_ROW_HEIGHT } from "@/components/dashboard/LedgerScroller";
import { money, moneyHint } from "@/lib/format";
import { linkUrl, type AffiliateLinkStats } from "@/lib/affiliateLink";
import { LinkDialog } from "./LinkDialog";
import { deleteLinkAction } from "./actions";

/**
 * Every link the Affiliate has, as a ledger.
 *
 * `table-fixed` with a percentage per column, the same as the owner's
 * commissions ledger: under auto layout a `max-width` on a cell is ignored, so
 * one long URL widens the table past its card instead of truncating inside it.
 *
 * The edit dialog and the delete confirmation live here rather than inside the
 * row menu. A menu unmounts its content when it closes, which would take the
 * dialog it just opened with it, so the menu only sets which row is being
 * acted on.
 */
export function LinksTable({
  links,
  websiteUrl,
}: {
  links: AffiliateLinkStats[];
  websiteUrl: string;
}) {
  const [editing, setEditing] = useState<AffiliateLinkStats | null>(null);
  const [deleting, setDeleting] = useState<AffiliateLinkStats | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-1 flex-col lg:min-h-0">
      <LedgerScroller>
        {/* The percentage columns collapse into each other on a phone, where
            the card is a third of its desktop width. A floor plus the table
            container's own horizontal scroll keeps the row readable there. */}
        <Table className="table-fixed min-w-[30rem]">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="w-[50%]">Link</TableHead>
              <TableHead className="w-[11%] text-right">Clicks</TableHead>
              <TableHead className="w-[11%] text-right">Conv.</TableHead>
              <TableHead className="w-[19%] text-right">Earned</TableHead>
              <TableHead className="w-[9%]">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {/* The ledger keeps its rule under the last row too, which the
              table strips by default. Without it the one link a new Affiliate
              has floats a full row above the first filler line. */}
          <TableBody className="[&_tr:last-child]:border-b">
            {links.map((link, i) => {
              const url = linkUrl(websiteUrl, link);
              const hint = moneyHint(link.earned);
              return (
                <TableRow
                  key={link.id}
                  className={`animate-in fade-in fill-mode-both duration-300 ${LEDGER_ROW_HEIGHT}`}
                  style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{link.code}</span>
                          {link.isPrimary && <Badge variant="outline">Primary</Badge>}
                        </span>
                        <code className="truncate font-mono text-[11px] text-muted-foreground">
                          {url}
                        </code>
                      </div>
                      <CopyLinkButton size="sm" link={url} label="Copy" />
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {link.clicks}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {link.conversions}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col">
                      <span className="truncate font-mono text-sm tabular-nums">
                        {money(link.earned)}
                      </span>
                      {hint && (
                        <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
                          {hint}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for ${link.code}`}
                            className="cursor-pointer"
                          />
                        }
                      >
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-36">
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onClick={() => setEditing(link)}
                        >
                          <Pencil />
                          <span>Edit</span>
                        </DropdownMenuItem>
                        {/* The signup link has no Delete at all rather than a
                            Delete that refuses. The lib refuses it too. */}
                        {!link.isPrimary && (
                          <DropdownMenuItem
                            variant="destructive"
                            className="cursor-pointer"
                            onClick={() => setDeleting(link)}
                          >
                            <Trash2 />
                            <span>Delete</span>
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </LedgerScroller>

      {/* Keyed on the row, so opening a second link's dialog starts from that
          link's values rather than the previous one's draft. */}
      {editing && (
        <LinkDialog
          key={editing.id}
          websiteUrl={websiteUrl}
          link={editing}
          open
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              The link stops working straight away. The clicks and commissions it already
              brought in stay on your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer" disabled={isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="cursor-pointer"
              disabled={isPending}
              onClick={() => {
                const target = deleting;
                if (!target) return;
                startTransition(async () => {
                  const result = await deleteLinkAction(target.id);
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success("Link deleted");
                  setDeleting(null);
                });
              }}
            >
              Delete link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
