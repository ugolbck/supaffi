"use client";

import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

type Merchant = { id: string; slug: string; name: string };

const STATIC_LABELS: Record<string, string> = {
  dashboard: "Products",
  products: "Products",
  new: "New",
  edit: "Edit",
  commissions: "Commissions",
  programs: "Programs",
  affiliates: "Affiliates",
  integrations: "Integrations",
  stripe: "Stripe",
  resend: "Resend",
  tracking: "Tracking",
};

export function DashboardBreadcrumb({ merchants }: { merchants: Merchant[] }) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  const crumbs: { label: string; href: string; isLinkable: boolean }[] = [];
  let href = "";
  for (const segment of segments) {
    href += `/${segment}`;
    const merchant = merchants.find((m) => m.slug === segment);
    const isRawFallback = !merchant && !(segment in STATIC_LABELS);
    const label = merchant ? merchant.name : STATIC_LABELS[segment] ?? segment;
    if (crumbs.length > 0 && crumbs[crumbs.length - 1].label === label) continue;
    // A segment with no static label and no Merchant match is an id or a slug
    // with no page of its own, so it is text, not a link.
    const isLinkable = !isRawFallback;
    crumbs.push({ label, href, isLinkable });
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, i) => (
          <span key={crumb.href} className="flex items-center gap-1.5">
            <BreadcrumbItem>
              {i === crumbs.length - 1 ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              ) : crumb.isLinkable ? (
                <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
              ) : (
                <span>{crumb.label}</span>
              )}
            </BreadcrumbItem>
            {i < crumbs.length - 1 && <BreadcrumbSeparator />}
          </span>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
