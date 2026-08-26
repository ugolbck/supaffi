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

  const crumbs: { label: string; href: string; isLinkable: boolean }[] = [];
  let href = "";
  for (const segment of segments) {
    href += `/${segment}`;
    const merchant = merchants.find((m) => m.id === segment);
    const isRawFallback = !merchant && !(segment in STATIC_LABELS);
    const label = merchant ? merchant.name : STATIC_LABELS[segment] ?? segment;
    if (crumbs.length > 0 && crumbs[crumbs.length - 1].label === label) continue;
    // "programs" has no standalone page (only /programs/new and
    // /programs/[id]/edit exist), and a segment with no static label or
    // Merchant match has no known page either — neither should ever link.
    const isLinkable = segment !== "programs" && !isRawFallback;
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
