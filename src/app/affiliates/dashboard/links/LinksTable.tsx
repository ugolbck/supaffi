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
import { money, moneyHint } from "@/lib/format";
import { linkUrl, type AffiliateLinkStats } from "@/lib/affiliateLink";
import { LinkDialog } from "./LinkDialog";
import { deleteLinkAction } from "./actions";

/**
 * Every link the affiliate has, on the ledger's own treatment: the neutral
 * header band, the hairline row rules, the earnings as the heaviest figure in
 * the row. Below `md` the same rows stack, since a phone has no room for six
 * columns.
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

  function RowMenu({ link }: { link: AffiliateLinkStats }) {
    return (
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
          <DropdownMenuItem className="cursor-pointer" onClick={() => setEditing(link)}>
            <Pencil />
            <span>Edit</span>
          </DropdownMenuItem>
          {/* The signup link has no Delete at all rather than a Delete that
              refuses. The lib refuses it too. */}
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
    );
  }

  return (
    <>
      <ul className="divide-y divide-neutral-200 md:hidden">
        {links.map((link) => {
          const url = linkUrl(websiteUrl, link);
          return (
            <li key={link.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{link.code}</span>
                {link.isPrimary && <Badge variant="outline">Primary</Badge>}
                <span className="ml-auto shrink-0">
                  <RowMenu link={link} />
                </span>
              </div>
              <code className="truncate font-mono text-xs text-muted-foreground">{url}</code>
              {/* The counts give way before the money does. */}
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[13px] text-muted-foreground tabular-nums">
                  {link.clicks} clicks · {link.conversions} sales
                </span>
                <span className="shrink-0 font-mono text-[13px] font-semibold text-neutral-900 tabular-nums">
                  {money(link.earned)}
                </span>
              </div>
              {/* Its own row and the full width of it: copying the link is what
                  someone opens this screen on a phone to do, and it should not
                  compete with the code for space. */}
              <div className="[&_button]:w-full">
                <CopyLinkButton size="sm" link={url} label="Copy link" />
              </div>
            </li>
          );
        })}
      </ul>

      <Table className="hidden table-fixed md:table">
        <TableHeader className="sticky top-0 z-10 bg-neutral-100">
          <TableRow className="border-neutral-200 hover:bg-transparent">
            <TableHead className="h-9 w-[46%] px-4 text-[13px] font-semibold text-neutral-700">
              Link
            </TableHead>
            <TableHead className="h-9 w-[10%] px-4 text-right text-[13px] font-semibold text-neutral-700">
              Clicks
            </TableHead>
            <TableHead className="h-9 w-[10%] px-4 text-right text-[13px] font-semibold text-neutral-700">
              Sales
            </TableHead>
            <TableHead className="h-9 w-[18%] px-4 text-right text-[13px] font-semibold text-neutral-700">
              Earned
            </TableHead>
            <TableHead className="h-9 w-[16%] px-4">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="divide-y divide-neutral-200">
          {links.map((link) => {
            const url = linkUrl(websiteUrl, link);
            const hint = moneyHint(link.earned);
            return (
              <TableRow key={link.id} className="border-neutral-200 hover:bg-neutral-50">
                <TableCell className="px-4 py-3">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{link.code}</span>
                    {link.isPrimary && <Badge variant="outline">Primary</Badge>}
                  </span>
                  {/* The URL is the thing being shared, so it is on the row
                      rather than behind the copy button alone. */}
                  <code className="block truncate font-mono text-xs text-muted-foreground">
                    {url}
                  </code>
                </TableCell>
                <TableCell className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                  {link.clicks}
                </TableCell>
                <TableCell className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                  {link.conversions}
                </TableCell>
                <TableCell className="px-4 py-3 text-right">
                  <span className="block font-mono text-[15px] font-semibold whitespace-nowrap text-neutral-900 tabular-nums">
                    {money(link.earned)}
                  </span>
                  {hint && (
                    <span className="block font-mono text-[11px] text-muted-foreground tabular-nums">
                      {hint}
                    </span>
                  )}
                </TableCell>
                <TableCell className="px-4 py-3">
                  <span className="flex items-center justify-end gap-1.5">
                    <CopyLinkButton size="sm" link={url} label="Copy" />
                    <RowMenu link={link} />
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

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
    </>
  );
}
