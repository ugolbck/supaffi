"use client";

import { ChevronsUpDown, LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { signOutAction } from "./signOutAction";

export function AccountMenu({ email }: { email: string }) {
  const initial = email.charAt(0).toUpperCase() || "?";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" className="gap-2.5" />}
          >
            <Avatar className="size-8 shrink-0">
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-sm font-medium">Owner</span>
              <span className="truncate text-xs text-muted-foreground">{email}</span>
            </span>
            <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-60" />
          </DropdownMenuTrigger>
          {/* side="top" so the menu opens up out of the footer instead of
              off the bottom of the viewport. */}
          <DropdownMenuContent side="top" align="start" className="min-w-56">
            <div className="px-2 py-1.5">
              <p className="truncate text-sm font-medium">Owner</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
            <DropdownMenuSeparator />
            <form action={signOutAction}>
              <DropdownMenuItem render={<button type="submit" className="w-full" />}>
                <LogOut />
                <span>Log out</span>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
