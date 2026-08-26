"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, LayoutDashboard, Receipt } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type Merchant = { id: string; name: string; domain: string };

export function AppSidebar({ merchants }: { merchants: Merchant[] }) {
  const pathname = usePathname();
  const merchantMatch = pathname.match(/^\/dashboard\/merchants\/([^/]+)/);
  const activeMerchantId = merchantMatch?.[1];
  const activeMerchant = merchants.find((m) => m.id === activeMerchantId);

  return (
    <Sidebar>
      <SidebarHeader>
        <span className="px-2 text-sm font-heading font-extrabold tracking-tight">
          Supaffi
        </span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Merchants</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === "/dashboard"}
                  render={<Link href="/dashboard" />}
                >
                  <LayoutDashboard />
                  <span>All Merchants</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {merchants.map((m) => (
                <SidebarMenuItem key={m.id}>
                  <SidebarMenuButton
                    isActive={pathname === `/dashboard/merchants/${m.id}`}
                    render={<Link href={`/dashboard/merchants/${m.id}`} />}
                  >
                    <Building2 />
                    <span>{m.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {activeMerchant && (
          <SidebarGroup>
            <SidebarGroupLabel>{activeMerchant.name}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname === `/dashboard/merchants/${activeMerchant.id}`}
                    render={<Link href={`/dashboard/merchants/${activeMerchant.id}`} />}
                  >
                    <Building2 />
                    <span>Overview</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname.startsWith(
                      `/dashboard/merchants/${activeMerchant.id}/commissions`
                    )}
                    render={<Link href={`/dashboard/merchants/${activeMerchant.id}/commissions`} />}
                  >
                    <Receipt />
                    <span>Commissions</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
