"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpCircle, ChevronsUpDown, LogOut, ShieldAlert, UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { signOutAction } from "./signOutAction";
import { UpdateDialog, type UpdateInfo } from "./VersionNotice";

/**
 * Who is signed in, and everything that belongs to the account rather than to
 * a product: its settings, the way out, and which Supaffi this is.
 *
 * The version lives in here rather than printed under the sidebar, where it
 * was a line of text nobody needed on every screen. An available update is
 * the exception worth surfacing without opening anything: a dot on the
 * avatar, red when the update fixes a security issue.
 */
export function AccountMenu({
  email,
  version,
  update,
}: {
  email: string;
  version: string;
  update: UpdateInfo | null;
}) {
  const [updateOpen, setUpdateOpen] = useState(false);
  const initial = email.charAt(0).toUpperCase() || "?";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-12 w-full cursor-pointer items-center gap-2.5 rounded-(--radius-md) px-2 text-left transition-[background-color] duration-150 hover:bg-black/[0.04] data-popup-open:bg-black/[0.04]">
          <span className="relative shrink-0">
            <Avatar className="size-8">
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
            {update && (
              <span
                aria-label={update.security ? "Security update available" : "Update available"}
                className={cn(
                  "absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-(--shell)",
                  update.security ? "bg-status-danger" : "bg-accent-600"
                )}
              />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-neutral-700">{email}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>

        {/* Opens upwards, out of the footer, as wide as the row it came from. */}
        <DropdownMenuContent side="top" align="start" sideOffset={6}>
          <DropdownMenuItem className="h-9 gap-2.5" render={<Link href="/dashboard/account" />}>
            <UserRound />
            Account
          </DropdownMenuItem>
          {update && (
            <DropdownMenuItem
              className={cn("h-9 gap-2.5", update.security && "text-status-danger")}
              onClick={() => setUpdateOpen(true)}
            >
              {update.security ? <ShieldAlert /> : <ArrowUpCircle />}
              <span className="flex-1">{update.security ? "Security update" : "Update available"}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{update.version}</span>
            </DropdownMenuItem>
          )}
          <form action={signOutAction}>
            <DropdownMenuItem className="h-9 w-full gap-2.5" render={<button type="submit" />}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </form>
          <DropdownMenuSeparator />
          <p className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground tabular-nums">Supaffi {version}</p>
        </DropdownMenuContent>
      </DropdownMenu>

      {update && (
        <UpdateDialog installed={version} update={update} open={updateOpen} onOpenChange={setUpdateOpen} />
      )}
    </>
  );
}
