import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Cards are content sized. Air is allowed. A page that comes up short is a
 * page with less to say, not a layout bug to pad over. The one height rule
 * left is that a table scrolls inside its card, so the page never does.
 */
export function Page({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-0 w-full flex-col gap-6">{children}</div>;
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex shrink-0 items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-[22px] font-semibold tracking-tight text-balance">{title}</h1>
        {subtitle && <p className="text-[13px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Tiles({ children, columns = 4 }: { children: ReactNode; columns?: 3 | 4 }) {
  return (
    <div className={cn("grid shrink-0 grid-cols-2 gap-3", columns === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4")}>
      {children}
    </div>
  );
}

export function Section({
  title,
  actions,
  scroll = false,
  fill = false,
  flush = false,
  className,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  scroll?: boolean;
  /** Body stretches to the card's height: a chart draws into whatever it is given. */
  fill?: boolean;
  /** Body runs to the card's edge: a list or a table brings its own row padding. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-(--radius-md) border border-black/[0.08] bg-elevated",
        (scroll || fill) && "min-h-0 flex-1",
        className
      )}
    >
      {(title || actions) && (
        <div className="flex shrink-0 items-center justify-between px-5 pt-4 pb-3">
          {title && <h2 className="text-sm font-medium">{title}</h2>}
          {actions}
        </div>
      )}
      <div
        className={cn(
          !flush && "px-5 pb-5",
          !flush && !title && !actions && "pt-5",
          (scroll || fill) && "flex min-h-0 flex-1 flex-col",
          scroll && "overflow-auto"
        )}
      >
        {children}
      </div>
    </section>
  );
}
