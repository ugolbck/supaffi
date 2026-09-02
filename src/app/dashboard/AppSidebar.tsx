"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Code2,
  LayoutDashboard,
  Lock,
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
    key: "programs",
    icon: Percent,
    label: "Programs",
    locked: "The commission terms Affiliates sign up under.",
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
    key: "tracking",
    icon: Code2,
    label: "Tracking",
    locked: "The snippets that tell Supaffi which sale an affiliate sent.",
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

        <SidebarGroup>
          <SidebarGroupLabel>{activeMerchant?.name ?? "Manage"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {MERCHANT_NAV.map((item) => {
                if (!activeMerchant) {
                  return (
                    <LockedItem
                      key={item.key}
                      item={item}
                      reason="Unlocks once you add your first product."
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
