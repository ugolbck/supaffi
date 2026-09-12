"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHART_RANGES, DEFAULT_RANGE, isChartRange, type ChartRange } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * The window the dashboard shows, kept in the URL.
 *
 * A query parameter rather than client state, so a reload lands on the same
 * view and a link to "this month" is a link. The page re-renders on the
 * server with the new window; the trigger spins for as long as that takes,
 * so a slow month is a visible wait and not a dead control.
 */
export function RangePicker({ value, className }: { value: ChartRange; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function choose(next: string | null) {
    if (!isChartRange(next) || next === value) return;
    // Built from the current query rather than from the path, so choosing a
    // range does not silently drop the currency beside it.
    const query = new URLSearchParams(params);
    if (next === DEFAULT_RANGE) query.delete("range");
    else query.set("range", next);
    const search = query.toString();
    startTransition(() => router.push(search ? `${pathname}?${search}` : pathname, { scroll: false }));
  }

  return (
    <Select
      value={value}
      onValueChange={choose}
      // Base UI prints the raw value in the trigger unless told the labels.
      items={Object.fromEntries(CHART_RANGES.map((range) => [range.id, range.label]))}
    >
      <SelectTrigger size="sm" className={cn("cursor-pointer text-[13px]", className)} aria-label="Time range">
        {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {CHART_RANGES.map((range) => (
          <SelectItem key={range.id} value={range.id}>
            {range.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
