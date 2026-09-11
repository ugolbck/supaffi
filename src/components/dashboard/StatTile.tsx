import { Sparkline } from "@/components/charts/Sparkline";

/**
 * One number, and enough shape to make it worth a whole cell.
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
    neutral: "",
    accent: "text-accent-700",
    success: "text-status-success",
    warning: "text-status-warning",
  }[tone];

  return (
    <div className="flex flex-col justify-between gap-2 rounded-(--radius-md) border border-border/70 bg-elevated [background-image:var(--elevated-surface)] px-3.5 py-3 shadow-[var(--edge-light),var(--shadow-xs)]">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span
          // Never truncated, and a step smaller on a phone, where the tiles are
          // two up: an amount cut to "1220.0…" is a wrong number. If it still
          // will not fit it wraps at the space before the currency, which
          // leaves both halves readable.
          className={`font-heading text-lg leading-tight font-semibold tracking-tight tabular-nums sm:text-2xl sm:leading-none ${valueTone}`}
        >
          {value}
        </span>
      </div>
      {series && series.length > 1 && series.some((n) => n !== 0) ? (
        <Sparkline points={series} className="h-6 w-full text-accent-500" />
      ) : (
        <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
          {hint ?? " "}
        </span>
      )}
    </div>
  );
}
