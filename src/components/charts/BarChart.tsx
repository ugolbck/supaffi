"use client";

import { useState } from "react";
import type { DayPoint } from "@/lib/analytics";

/**
 * Clicks and conversions per day, as bars that fill their container.
 *
 * Hand-rolled rather than pulled from a charting library: the whole thing is
 * two stacked rectangles per day, and a dependency would cost more than it
 * saves.
 *
 * The bars are sized in percentages of the plot area, so the chart fills
 * whatever height its card gives it. Every day in the window gets a bar, zeros
 * included, because a chart that skips quiet days lies about the shape.
 */

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export function BarChart({ series, className = "" }: { series: DayPoint[]; className?: string }) {
  const [hovered, setHovered] = useState<number | null>(null);

  // Two numbers, deliberately. `peak` is what the window actually did and is
  // what gets printed; `max` is the divisor, floored at 1 so an all-zero
  // series does not divide by zero. Printing the divisor would tell an
  // Affiliate with no traffic that their peak was 1.
  const peak = Math.max(0, ...series.map((d) => d.clicks));
  const max = Math.max(1, peak);
  const active = hovered === null ? null : series[hovered];

  // A label under every one of thirty bars is unreadable, so only the ends and
  // the middle are written out. The tooltip covers the rest.
  const labelled = new Set([0, Math.floor(series.length / 2), series.length - 1]);

  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-muted-foreground/35" />
          Clicks
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-accent-500" />
          Conversions
        </span>
        <span className="ml-auto font-mono tabular-nums">
          {active
            ? `${DAY.format(new Date(`${active.date}T00:00:00Z`))}  ${active.clicks} clicks  ${active.conversions} conv.`
            : `peak ${peak}`}
        </span>
      </div>

      <div
        className="flex min-h-16 flex-1 items-end gap-[3px]"
        onMouseLeave={() => setHovered(null)}
      >
        {series.map((day, i) => (
          <div
            key={day.date}
            onMouseEnter={() => setHovered(i)}
            className="group/bar flex h-full flex-1 cursor-default flex-col justify-end"
          >
            {/* The click bar is the full height for that day; conversions sit
                inside it, since every conversion started as a click. */}
            <div
              className={`relative w-full rounded-[3px] transition-colors duration-150 ease-[var(--ease-out)] ${
                hovered === i ? "bg-muted-foreground/50" : "bg-muted-foreground/25"
              }`}
              style={{ height: `${Math.max((day.clicks / max) * 100, day.clicks > 0 ? 4 : 2)}%` }}
            >
              {day.conversions > 0 && (
                <span
                  className="absolute inset-x-0 bottom-0 rounded-[3px] bg-accent-500"
                  style={{
                    height: `${Math.min(100, (day.conversions / Math.max(day.clicks, 1)) * 100)}%`,
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 justify-between text-[10px] text-muted-foreground tabular-nums">
        {series.map((day, i) =>
          labelled.has(i) ? (
            <span key={day.date}>{DAY.format(new Date(`${day.date}T00:00:00Z`))}</span>
          ) : null
        )}
      </div>
    </div>
  );
}
