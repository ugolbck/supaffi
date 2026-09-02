import type { ReactNode } from "react";

/**
 * The card every dashboard screen is built from.
 *
 * It stretches to its grid cell rather than sizing to its content, which is
 * what makes a page add up to exactly the viewport whether the account has one
 * affiliate or a thousand. The interior is a column so the body can take the
 * height it is given and the footer stays pinned to the bottom: content pooling
 * at the top of a tall card is the thing this exists to prevent.
 *
 * A card whose body can only ever be one line does not belong on a screen.
 * Fold it into a neighbour or into the signal row instead.
 */
export function DashboardCard({
  title,
  action,
  footer,
  children,
  className = "",
  bodyClassName = "",
  bodyScrolls = false,
}: {
  title?: string;
  /** Sits with the title, for the one control this card owns. */
  action?: ReactNode;
  /** Pinned to the bottom, separated by a rule. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Only a list that can outgrow its cell gets a scrollbar. */
  bodyScrolls?: boolean;
}) {
  return (
    <section
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-(--radius-xl) border border-border/70 bg-card [background-image:var(--card-surface)] shadow-[var(--edge-light),var(--shadow-sm)] ${className}`}
    >
      {title && (
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
          <h2 className="font-heading text-sm font-semibold tracking-tight">{title}</h2>
          {action}
        </div>
      )}
      <div
        className={`flex min-h-0 flex-1 flex-col px-4 ${title ? "pb-3.5" : "py-3.5"} ${
          bodyScrolls ? "overflow-y-auto" : ""
        } ${bodyClassName}`}
      >
        {children}
      </div>
      {footer && (
        <div className="shrink-0 border-t border-border/60 px-4 py-2.5">{footer}</div>
      )}
    </section>
  );
}

/**
 * What a card shows when it has nothing yet.
 *
 * Centred in the body rather than parked at the top, and always carrying the
 * action that would fill it, so an empty card still reads as a working part of
 * the page rather than a hole in it.
 */
export function CardEmpty({
  icon: Icon,
  title,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2.5 py-4 text-center">
      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <p className="max-w-52 text-xs leading-relaxed text-balance text-muted-foreground">
        {title}
      </p>
      {action}
    </div>
  );
}
