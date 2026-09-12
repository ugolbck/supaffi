import { Sparkline } from "@/components/charts/Sparkline";
import { cn } from "@/lib/utils";

/**
 * One number, and enough shape to make it worth a whole cell.
 *
 * Three sizes, three weights, one per line: a quiet capitalised label, the
 * number at the size that makes it the thing you read first, and a footnote
 * under it. The trend sits on the number's own line rather than below it,
 * which is what closes the hole a short tile used to leave under a bare
 * figure.
 *
 * The sparkline is not decoration. A tile carrying a bare number is short
 * enough to leave a gap in the signal row, and the trend answers the question
 * the number provokes anyway. A series of nothing but zeros has no trend to
 * draw, so it draws none: a flat line along the floor reads as data.
 */
export function StatTile({
  label,
  value,
  hint,
  series,
  tone = "neutral",
}: {
  label: string;
  value: string;
  /** Secondary line: a currency breakdown, a comparison, a state. */
  hint?: string;
  series?: number[];
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

  return (
    <div className="flex flex-col gap-2.5 rounded-(--radius-md) border border-(--card-hairline) bg-elevated px-4 py-3.5 shadow-(--shadow-raised)">
      <span className="truncate text-[11px] font-medium tracking-[0.05em] text-muted-foreground uppercase">
        {label}
      </span>
      <div className="flex items-end justify-between gap-3">
        {/* Never truncated, and a step smaller on a phone, where the tiles are
            two up: an amount cut to "1220.0…" is a wrong number. If it still
            will not fit it wraps at the space before the currency, which
            leaves both halves readable. */}
        <span
          className={cn(
            "font-heading leading-none font-semibold tracking-[-0.025em] tabular-nums",
            isFigure ? "text-[21px] sm:text-[26px]" : "text-[18px] sm:text-[21px]",
            valueTone
          )}
        >
          {value}
        </span>
        {trend && <Sparkline points={trend} className="h-7 w-20 shrink-0 text-accent-500" />}
      </div>
      {/* Always drawn, empty or not: the four tiles in a row share a grid
          cell height, so a missing footnote is a hole under the number rather
          than a shorter card. */}
      <span className="truncate text-[12px] text-muted-foreground tabular-nums">{hint ?? "\u00a0"}</span>
    </div>
  );
}
