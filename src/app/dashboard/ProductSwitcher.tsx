"use client";

import Link from "next/link";
import { Check, ChevronsUpDown, LayoutGrid, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

type Merchant = { id: string; slug: string; name: string; domain: string };

function Mark({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center bg-accent-700 font-medium text-accent-100",
        small ? "size-6 rounded-(--radius) text-[10px]" : "size-7 rounded-(--radius) text-[11px]"
      )}
    >
      {initials(name)}
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
  // Off a product's pages (the product list, the account) no product is
  // open, so the card says so rather than naming one at random.
  if (merchants.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-12 w-full cursor-pointer items-center gap-3 rounded-(--radius) border border-border bg-white px-2.5 text-left transition-[background-color,border-color] hover:border-neutral-300 duration-150 hover:bg-neutral-50 data-popup-open:bg-neutral-50">
        {active ? (
          <>
            <Mark name={active.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{active.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{active.domain}</span>
            </span>
          </>
        ) : (
          <>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-600">
              <LayoutGrid className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">All products</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {merchants.length === 1 ? "1 product" : `${merchants.length} products`}
              </span>
            </span>
          </>
        )}
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
            {m.id === active?.id && <Check className="size-4 text-foreground" />}
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
