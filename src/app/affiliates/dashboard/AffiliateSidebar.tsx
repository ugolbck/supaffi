"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, LinkIcon, Receipt, Wallet, type LucideIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * The affiliate's shell, on the owner dashboard's own sidebar: same floating
 * panel, same width, same row height and active state. An affiliate is in
 * their partner's house, so the header carries the merchant's name rather than
 * this product's, and there is no product switcher, because there is exactly
 * one merchant: whichever one owns the domain they are on.
 */

const BASE = "/affiliates/dashboard";

// Four sections, no gating. An affiliate has a link from the moment they sign
// up, so every one of these has something true to show on day one.
const NAV: { key: string; href: string; label: string; icon: LucideIcon }[] = [
  { key: "overview", href: "", label: "Overview", icon: Building2 },
  { key: "links", href: "/links", label: "Links", icon: LinkIcon },
  { key: "commissions", href: "/commissions", label: "Commissions", icon: Receipt },
  { key: "payouts", href: "/payouts", label: "Payouts", icon: Wallet },
];

/** The merchant's own mark, the same one the owner's product switcher draws. */
function Mark({ name }: { name: string }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-700 text-[11px] font-semibold text-accent-100">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function AffiliateSidebar({
  merchantName,
  merchantSite,
  email,
  payoutDetailsMissing = false,
  pathname: pathnameProp,
}: {
  merchantName: string;
  /** The host of the merchant's site, under their name. */
  merchantSite: string;
  email: string;
  /** Draws the waiting dot on Payouts. There is nowhere to send the money yet. */
  payoutDetailsMissing?: boolean;
  /** Overrides the live path, so the shell can be rendered in the dev kit. */
  pathname?: string;
}) {
  const livePathname = usePathname();
  const pathname = pathnameProp ?? livePathname;

  return (
    <Sidebar variant="floating" collapsible="offcanvas" className="p-3">
      <SidebarHeader className="p-3">
        <div className="flex h-11 w-full items-center gap-3 px-2 text-left">
          <Mark name={merchantName} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{merchantName}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{merchantSite}</span>
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {NAV.map((item) => {
                const href = `${BASE}${item.href}`;
                const current = item.href === "" ? pathname === BASE : pathname.startsWith(href);
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      isActive={current}
                      className="h-9 cursor-pointer gap-3 rounded-lg px-3 text-sm hover:bg-black/[0.04] data-active:bg-accent-50 data-active:text-accent-700"
                      render={<Link href={href} />}
                    >
                      <item.icon className="size-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {/* The one thing the shell can say without words: money is
                        waiting on something only they can fix. */}
                    {item.key === "payouts" && payoutDetailsMissing && (
                      <SidebarMenuBadge>
                        <span className="block size-2 rounded-full border-2 border-status-warning" />
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Who they are signed in as. Not a menu: an affiliate session has no
          account screen and no sign out to put behind one. */}
      <SidebarFooter className="p-3">
        <div className="flex items-center gap-2.5 px-2">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback>{email.charAt(0).toUpperCase() || "?"}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{email}</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
