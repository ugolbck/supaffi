"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Narrowing, not navigating. Same rule as the ledger's filter bar: every
 * control writes one query parameter and resets the page, so a filtered list
 * can be linked and reloaded, and paging stays a real document navigation.
 *
 * The program is addressed by its slug, like every other route in the
 * dashboard, so the URL stays readable and survives a cuid it never had to
 * carry.
 */
export function AffiliateFilters({
  programs,
  programSlug,
  query,
  anyFilterActive,
}: {
  programs: { slug: string; name: string }[];
  programSlug: string | null;
  query: string;
  anyFilterActive: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState(query);

  const current = programs.find((p) => p.slug === programSlug);

  function push(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    // Any change to what is being shown invalidates which page of it you were on.
    params.delete("page");
    const next = params.toString();
    router.push(next ? `${pathname}?${next}` : pathname);
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {programs.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer justify-between gap-1.5"
              />
            }
          >
            <span className={current ? "font-medium" : "text-muted-foreground"}>
              {current ? current.name : "All programs"}
            </span>
            <ChevronDown className="opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 min-w-52 overflow-y-auto">
            <DropdownMenuItem
              className="cursor-pointer"
              render={
                <button
                  type="button"
                  onClick={() => push({ program: null })}
                  className="w-full"
                />
              }
            >
              <Check className={programSlug === null ? "opacity-100" : "opacity-0"} />
              <span>All programs</span>
            </DropdownMenuItem>
            {programs.map((p) => (
              <DropdownMenuItem
                key={p.slug}
                className="cursor-pointer"
                render={
                  <button
                    type="button"
                    onClick={() => push({ program: p.slug })}
                    className="w-full"
                  />
                }
              >
                <Check className={programSlug === p.slug ? "opacity-100" : "opacity-0"} />
                <span className="truncate">{p.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <form
        className="relative min-w-52 flex-1 sm:max-w-xs"
        onSubmit={(event) => {
          event.preventDefault();
          push({ q: draft.trim() });
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          name="q"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Name, email or code"
          className="h-8 pl-8 text-sm"
        />
      </form>

      {anyFilterActive && (
        <Button
          variant="ghost"
          size="sm"
          className="cursor-pointer text-muted-foreground"
          onClick={() => {
            setDraft("");
            router.push(pathname);
          }}
        >
          <X />
          Clear
        </Button>
      )}
    </div>
  );
}
