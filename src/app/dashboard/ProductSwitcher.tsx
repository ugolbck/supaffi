"use client";

import Link from "next/link";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Merchant = { id: string; slug: string; name: string; domain: string };

function Mark({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center bg-accent-700 font-semibold text-accent-100",
        small ? "size-6 rounded-[5px] text-[10px]" : "size-7 rounded-md text-[11px]"
      )}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

/**
 * The product you are in, and the way to every other one.
 *
 * The menu opens exactly as wide as the card it came from, so it reads as that
 * card unfolding rather than as a second surface dropped beside it. The
 * product you are already in carries a tick instead of being left out, so the
 * list is the whole set and the reader can see where they are in it.
 */
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
      <DropdownMenuTrigger className="flex h-12 w-full cursor-pointer items-center gap-3 rounded-(--radius-md) border border-(--shell-border) bg-white px-2.5 text-left shadow-(--nav-active-shadow) transition-[background-color] duration-150 hover:bg-neutral-50 data-popup-open:bg-neutral-50">
        <Mark name={shown.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{shown.name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{shown.domain}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6}>
        {merchants.map((m) => (
          <DropdownMenuItem
            key={m.id}
            className="h-9 gap-2.5"
            render={<Link href={`/dashboard/products/${m.slug}`} />}
          >
            <Mark name={m.name} small />
            <span className="min-w-0 flex-1 truncate">{m.name}</span>
            {m.id === shown.id && <Check className="size-4 text-foreground" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="h-9 gap-2.5" render={<Link href="/onboarding" />}>
          <span className="flex size-6 shrink-0 items-center justify-center">
            <Plus className="size-4" />
          </span>
          Add a product
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
