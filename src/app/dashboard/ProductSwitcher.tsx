"use client";

import Link from "next/link";
import { ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Merchant = { id: string; slug: string; name: string; domain: string };

function Mark({ name }: { name: string }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-700 text-[11px] font-semibold text-accent-100">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function ProductSwitcher({
  merchants,
  active,
}: {
  merchants: Merchant[];
  active: Merchant | null;
}) {
  // The layout redirects to onboarding when an owner has no products, so
  // there is always at least one to fall back to.
  const shown = active ?? merchants[0];
  if (!shown) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left hover:bg-black/[0.04]">
        <Mark name={shown.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{shown.name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{shown.domain}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {merchants.map((m) => (
          <DropdownMenuItem
            key={m.id}
            className="cursor-pointer gap-3"
            render={<Link href={`/dashboard/products/${m.slug}`} />}
          >
            <Mark name={m.name} />
            <span className="truncate">{m.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer gap-3" render={<Link href="/onboarding" />}>
          <Plus className="size-4" />
          Add a product
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
