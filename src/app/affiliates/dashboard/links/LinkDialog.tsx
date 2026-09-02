"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { linkUrl } from "@/lib/affiliateLink";
import { createLinkAction, updateLinkAction } from "./actions";

/**
 * Creating a link and editing one are the same two fields, so they are the
 * same dialog. Absent `link` means create.
 *
 * Editing carries a warning that is not a formality: rewriting a code frees
 * the old one immediately and anything already shared with it stops earning.
 * There is no alias table and no grace period, which is why the confirm button
 * says what it does rather than "Save".
 *
 * The create trigger is built here rather than passed in from the page. Base
 * UI composes by a render prop, and an element the page hands over is a client
 * reference by the time the dialog clones it: the server renders it with the
 * primitive's `data-slot` and the client renders it with the Button's, which
 * is a hydration mismatch visible only in the browser console. Building the
 * element inside this client component removes the seam.
 *
 * Rows open this from their `⋯` menu instead, and a menu unmounts its content
 * on close, which would take the dialog with it. The row's dialog is therefore
 * driven by `open` from the table rather than by a trigger inside the menu.
 */
export function LinkDialog({
  websiteUrl,
  link,
  open: openProp,
  onOpenChange,
}: {
  websiteUrl: string;
  link?: { id: string; code: string; destinationPath: string | null; isPrimary: boolean };
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const fieldId = useId();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [code, setCode] = useState(link?.code ?? "");
  const [destination, setDestination] = useState(link?.destinationPath ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const open = openProp ?? uncontrolledOpen;
  const editing = link !== undefined;

  function setOpen(next: boolean) {
    // A cancelled edit must not leave its draft behind for the next open, and
    // a created link must not leave the form filled in.
    if (!next) {
      setCode(link?.code ?? "");
      setDestination(link?.destinationPath ?? "");
      setError(null);
    }
    if (onOpenChange) onOpenChange(next);
    else setUncontrolledOpen(next);
  }

  const preview = linkUrl(websiteUrl, {
    code: code.trim().toLowerCase() || "your-code",
    destinationPath: destination.trim() || null,
  });

  function submit() {
    setError(null);
    const input = { code, destinationPath: destination };
    startTransition(async () => {
      const result = link
        ? await updateLinkAction(link.id, input)
        : await createLinkAction(input);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setOpen(false);
      toast.success(link ? "Link updated" : "Link created");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {openProp === undefined && (
        <DialogTrigger render={<Button size="sm" className="cursor-pointer" />}>
          <Plus />
          New link
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit link" : "New link"}</DialogTitle>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-code`}>Code</Label>
            <Input
              id={`${fieldId}-code`}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="sarah-pricing"
              className="font-mono"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={30}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-destination`}>Destination</Label>
            <Input
              id={`${fieldId}-destination`}
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="/pricing"
              className="font-mono"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">Blank is the site root.</p>
          </div>

          <p className="truncate rounded-lg bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
            {preview}
          </p>

          {error && (
            <p role="alert" className="text-xs text-status-danger">
              {error}
            </p>
          )}

          {editing && (
            <p className="rounded-lg bg-status-warning-bg px-3 py-2 text-xs text-status-warning">
              Anyone who already has your old link will stop earning you commission. Clicks
              already recorded are safe.
            </p>
          )}

          <DialogFooter>
            <DialogClose
              render={<Button type="button" variant="outline" className="cursor-pointer" />}
              disabled={isPending}
            >
              Cancel
            </DialogClose>
            <Button type="submit" className="cursor-pointer" disabled={isPending}>
              {editing ? "Change code" : "Create link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
