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

type Merchant = { id: string; name: string };

const STATIC_LABELS: Record<string, string> = {
  dashboard: "Merchants",
  merchants: "Merchants",
  new: "New",
  edit: "Edit",
  commissions: "Commissions",
  programs: "Programs",
};

export function DashboardBreadcrumb({ merchants }: { merchants: Merchant[] }) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  const crumbs: { label: string; href: string }[] = [];
  let href = "";
  for (const segment of segments) {
    href += `/${segment}`;
    const merchant = merchants.find((m) => m.id === segment);
    const label = merchant ? merchant.name : STATIC_LABELS[segment] ?? segment;
    if (crumbs.length > 0 && crumbs[crumbs.length - 1].label === label) continue;
    crumbs.push({ label, href });
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, i) => (
          <span key={crumb.href} className="flex items-center gap-1.5">
            <BreadcrumbItem>
              {i === crumbs.length - 1 ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {i < crumbs.length - 1 && <BreadcrumbSeparator />}
          </span>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
