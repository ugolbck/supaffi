import type { ReactNode } from "react";

/**
 * The row template every dashboard screen uses.
 *
 * A screen is a header, a signal row, and one or two bands. The bands split the
 * leftover height between them, and the cards inside stretch to fill it, so the
 * page always comes out exactly the size of the content area.
 *
 * Every height rule is `lg:`-prefixed. Below that the grid is a single column
 * in normal document flow: pinning a stacked column to the viewport leaves
 * every card a sliver too short to read, so on narrow screens the page scrolls
 * like a page.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-4 lg:h-full lg:min-h-0">{children}</div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-heading text-xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Metric tiles, edge to edge. Two up on a phone, all of them on a desktop. */
export function SignalRow({ children, columns }: { children: ReactNode; columns: 4 | 5 | 6 }) {
  const lg = { 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" }[columns];
  return (
    <div className={`grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 ${lg}`}>{children}</div>
  );
}

/**
 * One horizontal band of cards.
 *
 * Two bands on a screen each take `lg:flex-1`, which splits the leftover height
 * evenly between them. Cards inside are grid items and stretch to the band, so
 * none of them is sized by its own content.
 *
 * `columns` is a prop rather than something the caller passes through
 * `className`, because two `lg:grid-cols-*` classes on one element resolve by
 * stylesheet order, not by which one was written last, and the loser is
 * invisible until the cards come out the wrong width.
 */
const COLUMNS = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  12: "lg:grid-cols-12",
} as const;

export function Band({
  children,
  columns = 12,
  scrolls = false,
  className = "",
}: {
  children: ReactNode;
  columns?: keyof typeof COLUMNS;
  /**
   * For a band of repeating cards that can outgrow the viewport. Rows keep a
   * readable floor and the band scrolls past it, rather than every card
   * shrinking until none of them can be read.
   */
  scrolls?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:min-h-0 lg:flex-1 ${COLUMNS[columns]} ${
        scrolls ? "lg:auto-rows-[minmax(9rem,1fr)] lg:overflow-y-auto" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * How many columns a repeating card grid should use, and how far the trailing
 * ghost cell has to stretch to land the last row flush.
 *
 * A fixed three-column grid with one card leaves two holes, which is the dead
 * space this whole layout exists to remove.
 */
export function cardGrid(count: number): {
  columns: keyof typeof COLUMNS;
  ghostSpan: number;
} {
  const withGhost = count + 1;
  const columns = (withGhost <= 4 ? withGhost : 3) as keyof typeof COLUMNS;
  const remainder = count % columns;
  return { columns, ghostSpan: remainder === 0 ? columns : columns - remainder };
}
