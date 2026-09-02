"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, LinkIcon, Receipt, Wallet } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

// Four sections, no gating. An Affiliate has a link from the moment they sign
// up, so every one of these has something true to show on day one.
const NAV = [
  { key: "overview", href: "", label: "Overview", icon: LayoutGrid },
  { key: "links", href: "/links", label: "Links", icon: LinkIcon },
  { key: "commissions", href: "/commissions", label: "Commissions", icon: Receipt },
  { key: "payouts", href: "/payouts", label: "Payouts", icon: Wallet },
] as const;

const BASE = "/affiliates/dashboard";

export function AffiliateSidebar({
  merchantName,
  email,
}: {
  merchantName: string;
  email: string;
}) {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3">
        <span className="truncate font-heading text-sm font-semibold tracking-tight">
          {merchantName}
        </span>
        <span className="truncate text-xs text-muted-foreground">Affiliate</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV.map((item) => {
              const href = `${BASE}${item.href}`;
              return (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    isActive={pathname === href}
                    render={<Link href={href} className="cursor-pointer" />}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-4 py-3">
        <span className="truncate text-xs text-muted-foreground">{email}</span>
      </SidebarFooter>
    </Sidebar>
  );
}
