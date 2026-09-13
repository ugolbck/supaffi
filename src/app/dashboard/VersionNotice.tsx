"use client";

import { CopyLinkButton } from "@/components/CopyLinkButton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// The command is shown, never run. Updating from here would mean giving the
// web app control of Docker on the host, which is root on the whole machine,
// and that is the hole that gets self-hosted tools taken over. Whoever runs
// this already has a shell.
//
// Pinned to the release tag rather than to main. This script runs as root on
// the operator's server, so fetching it from a branch would mean the one
// genuinely privileged step in the whole system is the one thing not tied to a
// reviewed, released commit.
function updateCommand(version: string): string {
  return `cd /opt/supaffi && curl -fsSL https://raw.githubusercontent.com/ugolbck/supaffi/v${version}/install.sh | sudo bash`;
}

export type UpdateInfo = { version: string; url: string; security: boolean };

/**
 * How to move to a newer release, opened from the account menu.
 *
 * Controlled rather than owning its trigger, because the trigger is a menu
 * item and a menu unmounts its contents when it closes: a dialog rendered
 * inside it would vanish the moment the item that opened it was clicked.
 */
export function UpdateDialog({
  installed,
  update,
  open,
  onOpenChange,
}: {
  installed: string;
  update: UpdateInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const command = updateCommand(update.version);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {update.security ? `${update.version} fixes a security issue` : `Supaffi ${update.version} is out`}
          </DialogTitle>
          <DialogDescription>
            You are on {installed}. {update.security ? "Update soon." : "Nothing breaks if you wait."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Run this on your server. It backs up your database first and stops if that fails.
          </p>
          <pre className="overflow-x-auto rounded-(--radius-md) border border-border/70 bg-muted/50 px-3 py-2.5 font-mono text-xs leading-relaxed">
            <code>{command}</code>
          </pre>
          <div className="flex items-center gap-2">
            <CopyLinkButton link={command} size="sm" label="Copy" />
            <Button
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              render={<a href={update.url} target="_blank" rel="noreferrer" />}
            >
              What changed
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
