import Link from "next/link";
import type { CommissionStatus, StatusTotal } from "@/lib/commission";
import { money, moneyHint } from "@/lib/format";

/**
 * Count and money per status, doubling as the status filter.
 *
 * These replaced the Payouts and Flagged tabs. Tabs hid two thirds of the
 * ledger behind a click and still had no home for a PENDING commission, so an
 * Owner's first real sale was visible to the affiliate and invisible to them.
 * A tile says how much is in each state and takes one click to show only that.
 */

const LABELS: Record<CommissionStatus, string> = {
  PENDING: "Pending",
  PAYABLE: "Payable",
  FLAGGED: "Flagged",
  PAID: "Paid",
  VOIDED: "Voided",
};

// Only the two states that ask something of the Owner carry colour. Paid and
// voided are history, and pending is just waiting.
const ACCENTS: Partial<Record<CommissionStatus, string>> = {
  PAYABLE: "text-status-success",
  FLAGGED: "text-status-warning",
};

// The same money()/moneyHint() pairing the overview and products pages use,
// concatenated onto one line instead of stacked: this tile has room for one
// line of text, not two, but a two-currency merchant still deserves both
// real amounts here, not a headline figure and a bare count of what it hid.
function detailFor(amounts: { currency: string; total: string }[]): string {
  if (amounts.length === 0) return "—";
  const hint = moneyHint(amounts);
  return hint ? `${money(amounts)}  ·  ${hint}` : money(amounts);
}

function Tile({
  label,
  count,
  detail,
  href,
  active,
  accent,
}: {
  label: string;
  count: number;
  detail: string;
  href: string;
  active: boolean;
  accent?: string;
}) {
  return (
    <Link
      href={href}
      className={`group flex cursor-pointer flex-col gap-1 rounded-(--radius-lg) border px-3.5 py-3 transition-[border-color,background-color] duration-200 ease-[var(--ease-out)] ${
        active
          ? "border-primary/60 bg-elevated [background-image:var(--elevated-surface)] shadow-[var(--edge-light),var(--shadow-xs)]"
          : "border-border/70 bg-card/50 hover:border-border hover:bg-card"
      }`}
    >
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={`font-heading text-xl leading-none font-semibold tracking-tight tabular-nums ${accent ?? ""}`}
      >
        {count}
      </span>
      <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
        {detail}
      </span>
    </Link>
  );
}

export function StatusTiles({
  totals,
  activeStatus,
  hrefFor,
}: {
  totals: StatusTotal[];
  activeStatus: CommissionStatus | null;
  /** Null clears the status filter. */
  hrefFor: (status: CommissionStatus | null) => string;
}) {
  const allCount = totals.reduce((sum, t) => sum + t.count, 0);

  return (
    <div className="grid shrink-0 grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      <Tile
        label="All"
        count={allCount}
        detail={allCount === 0 ? "—" : "every status"}
        href={hrefFor(null)}
        active={activeStatus === null}
      />
      {totals.map((t) => (
        <Tile
          key={t.status}
          label={LABELS[t.status]}
          count={t.count}
          detail={detailFor(t.amounts)}
          href={hrefFor(t.status)}
          active={activeStatus === t.status}
          accent={t.count > 0 ? ACCENTS[t.status] : undefined}
        />
      ))}
    </div>
  );
}
