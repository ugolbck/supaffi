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
 */
export function Band({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-12 ${className}`}
    >
      {children}
    </div>
  );
}
