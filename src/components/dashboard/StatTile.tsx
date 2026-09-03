import { Sparkline } from "@/components/charts/Sparkline";

/**
 * One number, and enough shape to make it worth a whole cell.
 *
 * The sparkline is not decoration. A tile carrying a bare number is short
 * enough to leave a gap in the signal row, and the trend answers the question
 * the number provokes anyway.
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
  tone?: "neutral" | "success" | "warning";
}) {
  const valueTone = {
    neutral: "",
    success: "text-status-success",
    warning: "text-status-warning",
  }[tone];

  return (
    <div className="flex flex-col justify-between gap-2 rounded-(--radius-lg) border border-border/70 bg-elevated [background-image:var(--elevated-surface)] px-3.5 py-3 shadow-[var(--edge-light),var(--shadow-xs)]">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span
          className={`font-heading truncate text-2xl leading-none font-semibold tracking-tight tabular-nums ${valueTone}`}
        >
          {value}
        </span>
      </div>
      {series && series.length > 1 ? (
        <Sparkline points={series} className="h-6 w-full text-accent-500" />
      ) : (
        <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
          {hint ?? " "}
        </span>
      )}
    </div>
  );
}
