import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Sparkline } from "@/components/charts/Sparkline";
import { cn } from "@/lib/utils";

/**
 * One figure, its trend, and how it compares.
 *
 * Three lines, three weights. A plain label in sentence case, the figure at
 * the size that makes it the first thing read, and under it either how the
 * window compares with the one before it or, for a balance that has no
 * window, what it is waiting on. The trend sits beside the figure with the
 * same fade the main chart draws, so the row of tiles and the chart under
 * them are one drawing at two sizes.
 *
 * The comparison is green up, red down, grey for no change. It is the
 * quietest thing on the tile on purpose: it qualifies the figure, it does
 * not compete with it. No comparison is printed at all when there is
 * nothing to compare with, since "up from nothing" is not a percentage.
 */
export function StatTile({
  label,
  value,
  hint,
  series,
  delta,
  href,
  tone = "neutral",
}: {
  label: string;
  value: string;
  /** Footnote for a figure with no comparison: a balance, a state. */
  hint?: string;
  series?: number[];
  /** Change against the previous window, as a percentage, with what it was measured against. */
  delta?: { percent: number | null; against: string };
  /** Makes the whole tile a link, with a chevron to say so. */
  href?: string;
  tone?: "neutral" | "accent" | "success" | "warning";
}) {
  const valueTone = {
    neutral: "text-neutral-900",
    accent: "text-accent-700",
    success: "text-status-success",
    warning: "text-status-warning",
  }[tone];
  const trend = series && series.length > 1 && series.some((n) => n !== 0) ? series : null;
  // A figure earns the full size. "None yet" and "Live" are words, and a word
  // set as loud as a number shouts a non-answer across the row.
  const isFigure = /\d/.test(value);

  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[13px] font-medium text-neutral-700">{label}</span>
        {href && <ChevronRight className="size-4 shrink-0 text-neutral-400" />}
      </div>
      {/* The figure keeps its size and the trend gives way: it shrinks to
          whatever is left beside a wide amount and disappears before it
          would ever clip the number. */}
      <div className="flex items-end justify-between gap-3">
        <span
          className={cn(
            "shrink-0 font-heading leading-none font-semibold tracking-[-0.025em] tabular-nums",
            isFigure ? "text-[22px] @min-[200px]:text-[26px]" : "text-[18px] @min-[200px]:text-[21px]",
            valueTone
          )}
        >
          {value}
        </span>
        {trend && (
          <Sparkline
            points={trend}
            area
            className="hidden h-8 min-w-12 flex-1 basis-0 max-w-24 text-accent-500 @min-[200px]:block"
          />
        )}
      </div>
      {/* Always drawn, empty or not: the four tiles in a row share a grid
          cell height, so a missing footnote is a hole under the number rather
          than a shorter card. */}
      <div className="flex min-h-4 items-center gap-1.5 text-[12px] tabular-nums">
        {delta ? <Delta {...delta} /> : <span className="text-muted-foreground">{hint ?? " "}</span>}
      </div>
    </>
  );

  // A container, so the tile answers to its own width rather than the
  // viewport's: four up on a laptop and two up on a phone are different
  // widths at the same breakpoint. The widths below are content widths,
  // inside the padding, which is what a container query measures: about
  // 220 four up on a laptop, 160 on a small laptop, 120 two up on a phone.
  const surface =
    "@container flex flex-col gap-3 rounded-(--radius-md) border border-(--card-hairline) bg-elevated px-4 py-3.5 shadow-(--shadow-raised)";

  if (href) {
    return (
      <Link
        href={href}
        className={cn(surface, "cursor-pointer transition-[box-shadow,transform] duration-150 ease-(--ease-out) hover:shadow-(--shadow-md) active:scale-[0.99]")}
      >
        {body}
      </Link>
    );
  }
  return <div className={surface}>{body}</div>;
}

function Delta({ percent, against }: { percent: number | null; against: string }) {
  if (percent === null) {
    return <span className="text-muted-foreground">No earlier {against} to compare</span>;
  }
  const up = percent > 0;
  const flat = percent === 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  // On a tile too narrow for the sentence, the percentage stands alone: the
  // window it is measured against is the one named at the top of the page.
  return (
    <>
      <span
        className={cn(
          "flex items-center gap-0.5 font-medium",
          flat ? "text-muted-foreground" : up ? "text-status-success" : "text-status-danger"
        )}
      >
        <Icon className="size-3.5" />
        {Math.abs(percent).toLocaleString("en", { maximumFractionDigits: 1 })}%
      </span>
      <span className="hidden truncate text-muted-foreground @min-[190px]:inline">vs {against}</span>
    </>
  );
}
