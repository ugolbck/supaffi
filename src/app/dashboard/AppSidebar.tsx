"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Code2,
  LayoutDashboard,
  Percent,
  Plus,
  Plug,
  Receipt,
  Settings,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { AccountMenu } from "./AccountMenu";
import { VersionNotice, type UpdateInfo } from "./VersionNotice";

type Merchant = { id: string; slug: string; name: string; domain: string };

// One product's nav. Rendered only while a product is open: onboarding owns
// everything before that, so there is nothing left to grey out or lock. A
// section that has no product to point at is simply not on screen.
const MERCHANT_NAV = [
  { key: "overview", icon: Building2, label: "Overview" },
  { key: "integrations", icon: Plug, label: "Integrations" },
  { key: "programs", icon: Percent, label: "Programs" },
  { key: "affiliates", icon: Users, label: "Affiliates" },
  { key: "commissions", icon: Receipt, label: "Commissions" },
  { key: "tracking", icon: Code2, label: "Tracking" },
  { key: "settings", icon: Settings, label: "Settings" },
] as const;

export function AppSidebar({
  merchants,
  email,
  version,
  update,
}: {
  merchants: Merchant[];
  email: string;
  version: string;
  update: UpdateInfo | null;
}) {
  const pathname = usePathname();
  const merchantMatch = pathname.match(/^\/dashboard\/products\/([^/]+)/);
  const activeSlug = merchantMatch?.[1];
  const activeMerchant = merchants.find((m) => m.slug === activeSlug);
  const base = activeMerchant ? `/dashboard/products/${activeMerchant.slug}` : "";

  const merchantHrefs: Record<(typeof MERCHANT_NAV)[number]["key"], string> = {
    overview: base,
    integrations: `${base}/integrations`,
    programs: `${base}/programs`,
    affiliates: `${base}/affiliates`,
    commissions: `${base}/commissions`,
    tracking: `${base}/tracking`,
    settings: `${base}/edit`,
  };

  // Flagged used to be its own row pointing at ?status=FLAGGED. It is a filter
  // on the commissions ledger, not a place, and having both meant two rows
  // fighting over the same screen.
  function isActiveNav(key: (typeof MERCHANT_NAV)[number]["key"]): boolean {
    if (key === "overview") return pathname === base;
    if (key === "integrations") return pathname.startsWith(`${base}/integrations`);
    if (key === "tracking") return pathname === `${base}/tracking`;
    if (key === "settings") return pathname === `${base}/edit`;
    if (key === "programs") return pathname.startsWith(`${base}/programs`);
    if (key === "affiliates") return pathname.startsWith(`${base}/affiliates`);
    if (key === "commissions") return pathname.startsWith(`${base}/commissions`);
    return false;
  }

  return (
    <Sidebar>
      <SidebarHeader className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="gap-2.5 hover:bg-transparent active:bg-transparent"
              render={<Link href="/dashboard" />}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.svg"
                alt=""
                className="size-8 shrink-0 rounded-lg shadow-[var(--edge-strong),0_1px_2px_hsl(var(--shadow-color)/0.20)]"
              />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="font-heading truncate text-sm font-semibold tracking-tight">
                  Supaffi
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  Affiliate programs
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === "/dashboard"}
                  render={<Link href="/dashboard" />}
                >
                  <LayoutDashboard />
                  <span>Home</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Your products</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {merchants.map((m) => (
                <SidebarMenuItem key={m.id}>
                  <SidebarMenuButton
                    isActive={m.slug === activeSlug}
                    render={<Link href={`/dashboard/products/${m.slug}`} />}
                  >
                    <Building2 />
                    <span>{m.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === "/dashboard/products/new"}
                  className="text-muted-foreground"
                  render={<Link href="/dashboard/products/new" />}
                >
                  <Plus />
                  <span>{merchants.length === 0 ? "Add your product" : "Add a product"}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {activeMerchant && (
          <SidebarGroup>
            <SidebarGroupLabel>{activeMerchant.name}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {MERCHANT_NAV.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      isActive={isActiveNav(item.key)}
                      render={<Link href={merchantHrefs[item.key]} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <VersionNotice installed={version} update={update} />
        <AccountMenu email={email} />
      </SidebarFooter>
    </Sidebar>
  );
}
