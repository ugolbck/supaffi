"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Building2,
  Flag,
  LayoutDashboard,
  Lock,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountMenu } from "./AccountMenu";

type Merchant = { id: string; slug: string; name: string; domain: string };

// The nav a Merchant unlocks. Rendered for real once one exists, and as
// greyed-out rows before that — showing the shape of the product up front is
// what makes the empty state read as "not set up yet" instead of "broken".
const MERCHANT_NAV = [
  {
    key: "overview",
    icon: Building2,
    label: "Overview",
    locked: "Traffic, affiliates and revenue for one product.",
  },
  {
    key: "integrations",
    icon: Plug,
    label: "Integrations",
    locked: "Where your payment provider and email sending are connected.",
  },
  {
    key: "affiliates",
    icon: Users,
    label: "Affiliates",
    locked: "Everyone promoting your product, and what they've earned.",
  },
  {
    key: "commissions",
    icon: Receipt,
    label: "Commissions",
    locked: "What's owed, what's cleared the holding period, what's paid.",
  },
  {
    key: "flagged",
    icon: Flag,
    label: "Flagged",
    locked: "Refunds and suspicious referrals held back for review.",
  },
  {
    key: "settings",
    icon: Settings,
    label: "Settings",
    locked: "Stripe keys, tracking domain and email delivery.",
  },
] as const;

function LockedItem({
  item,
  reason,
}: {
  item: (typeof MERCHANT_NAV)[number];
  reason: string;
}) {
  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger
          render={
            // Deliberately not `disabled`/`aria-disabled`: the sidebar's own
            // styles kill pointer events on those, which would also kill the
            // hover that explains *why* the row is locked.
            <span className="flex h-8 w-full cursor-not-allowed items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm text-sidebar-foreground/45 select-none [&_svg]:size-4 [&_svg]:shrink-0" />
          }
        >
          <item.icon />
          <span className="flex-1 truncate">{item.label}</span>
          <Lock className="size-3 opacity-70" />
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-56">
          {item.locked} {reason}
        </TooltipContent>
      </Tooltip>
    </SidebarMenuItem>
  );
}

export function AppSidebar({
  merchants,
  email,
}: {
  merchants: Merchant[];
  email: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const merchantMatch = pathname.match(/^\/dashboard\/products\/([^/]+)/);
  const activeSlug = merchantMatch?.[1];
  const activeMerchant = merchants.find((m) => m.slug === activeSlug);
  const base = activeMerchant ? `/dashboard/products/${activeMerchant.slug}` : "";

  const merchantHrefs: Record<(typeof MERCHANT_NAV)[number]["key"], string> = {
    overview: base,
    integrations: `${base}/integrations`,
    affiliates: base,
    commissions: `${base}/commissions`,
    flagged: `${base}/commissions?status=FLAGGED`,
    settings: `${base}/edit`,
  };

  // Commissions and Flagged are the same screen, told apart only by the status
  // filter, so pathname alone would light up both rows at once.
  const onCommissions = pathname.startsWith(`${base}/commissions`);
  const flaggedFilter = searchParams.get("status") === "FLAGGED";
  function isActiveNav(key: (typeof MERCHANT_NAV)[number]["key"]): boolean {
    if (key === "overview") return pathname === base;
    if (key === "integrations") return pathname.startsWith(`${base}/integrations`);
    if (key === "settings") return pathname === `${base}/edit`;
    if (key === "commissions") return onCommissions && !flaggedFilter;
    if (key === "flagged") return onCommissions && flaggedFilter;
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

        <SidebarGroup>
          <SidebarGroupLabel>{activeMerchant?.name ?? "Manage"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {MERCHANT_NAV.map((item) => {
                // Affiliates has no page yet, so it stays locked even with a
                // Merchant selected — with a reason that says so, rather than
                // the "add a product" one that would now be a lie.
                if (!activeMerchant || item.key === "affiliates") {
                  return (
                    <LockedItem
                      key={item.key}
                      item={item}
                      reason={
                        activeMerchant
                          ? "Not built yet."
                          : "Unlocks once you add your first product."
                      }
                    />
                  );
                }
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      isActive={isActiveNav(item.key)}
                      render={<Link href={merchantHrefs[item.key]} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <AccountMenu email={email} />
      </SidebarFooter>
    </Sidebar>
  );
}
