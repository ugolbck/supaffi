"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Code2,
  LayoutGrid,
  Percent,
  Receipt,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { ProductSwitcher } from "./ProductSwitcher";
import { AccountMenu } from "./AccountMenu";
import { VersionNotice, type UpdateInfo } from "./VersionNotice";

// One raised tile for the open section; every other row is flat on the
// canvas and only tints on hover. The tile's edge comes from its shadow, not
// a border, so it reads as lifted rather than outlined.
// The primitive centres its badge on a 32px row. Ours are 40px and padded
// 12px, so the badge drops to the row's middle and lines up with the label's
// right padding.
const NAV_BADGE = "right-3 peer-data-[size=default]/menu-button:top-2.5";

const NAV_ROW =
  "h-10 cursor-pointer gap-3 rounded-lg px-3 text-sm text-neutral-700 transition-[background-color,box-shadow,color] duration-150 hover:bg-black/[0.04] hover:text-foreground data-active:bg-(--nav-active) data-active:text-foreground data-active:shadow-(--nav-active-shadow) data-active:hover:bg-(--nav-active) [&_svg]:text-neutral-500 data-active:[&_svg]:text-foreground";

type Merchant = { id: string; slug: string; name: string; domain: string };

export type Counts = {
  affiliates: number;
  programs: number;
  payable: number;
  tracking: "not-started" | "awaiting-sale" | "verified";
};

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
  badge: number | null;
  dot?: "ok" | "waiting";
};

// The active product comes from the URL, read here rather than in the layout:
// a layout does not re-render when the user moves between two products, so a
// server-picked active product would go stale on the first switch.
export function AppSidebar({
  merchants,
  counts,
  email,
  version,
  update,
}: {
  merchants: Merchant[];
  counts: Record<string, Counts>;
  email: string;
  version: string;
  update: UpdateInfo | null;
}) {
  const pathname = usePathname();
  const activeSlug = pathname.match(/^\/dashboard\/products\/([^/]+)/)?.[1];
  const active = merchants.find((m) => m.slug === activeSlug) ?? null;
  const activeCounts = active ? counts[active.slug] : undefined;
  const base = active ? `/dashboard/products/${active.slug}` : null;

  // Rows for a product that is not open would point nowhere, so there are
  // none. Nothing is greyed out or padlocked; it is simply absent.
  const nav: NavItem[] =
    base && activeCounts
      ? [
          { href: base, icon: Building2, label: "Overview", badge: null },
          {
            href: `${base}/affiliates`,
            icon: Users,
            label: "Affiliates",
            badge: activeCounts.affiliates || null,
          },
          {
            href: `${base}/programs`,
            icon: Percent,
            label: "Programs",
            badge: activeCounts.programs || null,
          },
          {
            href: `${base}/commissions`,
            icon: Receipt,
            label: "Commissions",
            badge: activeCounts.payable || null,
          },
          {
            href: `${base}/tracking`,
            icon: Code2,
            label: "Tracking",
            badge: null,
            // Green means a sale came through, amber means the script is on
            // the site and nothing has sold yet, and nothing at all means
            // tracking has not started. A dot for the last one would claim
            // there is something to look at.
            dot:
              activeCounts.tracking === "verified"
                ? "ok"
                : activeCounts.tracking === "awaiting-sale"
                  ? "waiting"
                  : undefined,
          },
          { href: `${base}/settings`, icon: Settings, label: "Settings", badge: null },
        ]
      : [];

  return (
    <Sidebar variant="inset" collapsible="offcanvas" className="p-3">
      <SidebarHeader className="p-3">
        <ProductSwitcher merchants={merchants} active={active} />
      </SidebarHeader>

      <SidebarContent className="px-3">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {nav.map((item) => {
                const current =
                  item.href === base ? pathname === base : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={current}
                      className={NAV_ROW}
                      render={<Link href={item.href} />}
                    >
                      <item.icon className="size-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {item.badge !== null && (
                      <SidebarMenuBadge className={cn(NAV_BADGE, "text-muted-foreground tabular-nums")}>
                        {item.badge}
                      </SidebarMenuBadge>
                    )}
                    {item.dot && (
                      <SidebarMenuBadge className={NAV_BADGE}>
                        <span
                          className={cn(
                            "block size-2 rounded-full",
                            item.dot === "ok"
                              ? "bg-status-success"
                              : "border-2 border-status-warning"
                          )}
                        />
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-1 p-3">
        {merchants.length > 1 && (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname === "/dashboard"}
                className={NAV_ROW}
                render={<Link href="/dashboard" />}
              >
                <LayoutGrid className="size-4" />
                <span>All products</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        <VersionNotice installed={version} update={update} />
        <AccountMenu email={email} />
      </SidebarFooter>
    </Sidebar>
  );
}
