import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SETUP_STEP_COUNT } from "@/lib/productSetup";

/**
 * The frame every setup screen shares.
 *
 * Each step page used to size and title itself: four different max widths, four
 * hand-rolled `← Product` links, four takes on where the status pill goes. That
 * reads as four different products. Everything structural lives here now, so a
 * step page only supplies its own content.
 *
 * There is no back link. The breadcrumb in the top bar already goes backwards,
 * and setup is meant to run forwards: the way out of a step is the next step,
 * not a return trip to the product page between every one.
 */

const MAX_WIDTH = "max-w-5xl";

function StepRail({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-[11px] font-medium tracking-[0.14em] text-accent-700 uppercase tabular-nums">
        Step {step} of {SETUP_STEP_COUNT}
      </span>
      <div className="h-1 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-accent-500 transition-[width] duration-500 ease-[var(--ease-out)]"
          style={{ width: `${(step / SETUP_STEP_COUNT) * 100}%` }}
        />
      </div>
    </div>
  );
}

export function SetupShell({
  step,
  title,
  lede,
  mark,
  status,
  children,
  aside,
  merchantId,
  next,
}: {
  /** Which of the four setup steps this screen is. */
  step: number;
  title: string;
  lede: string;
  /** Provider logo, for the screens that connect one. */
  mark?: React.ReactNode;
  /** Connected / verified pill, sitting with the title rather than below it. */
  status?: React.ReactNode;
  children: React.ReactNode;
  /** Optional right rail. Without it the content runs the full width. */
  aside?: React.ReactNode;
  merchantId: string;
  /** Where this step leads. Null once there is nothing left to do. */
  next: { label: string; href: string } | null;
}) {
  return (
    <div className={`mx-auto flex w-full ${MAX_WIDTH} flex-col gap-5 lg:h-full lg:min-h-0`}>
      <header className="flex shrink-0 flex-col gap-2.5">
        <StepRail step={step} />
        <div className="flex flex-wrap items-center gap-3">
          {mark}
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">{title}</h1>
          {status}
        </div>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{lede}</p>
      </header>

      <div
        className={`grid gap-5 lg:min-h-0 lg:flex-1 ${aside ? "lg:grid-cols-5" : "lg:grid-cols-1"}`}
      >
        <div className={`flex flex-col lg:min-h-0 ${aside ? "lg:col-span-3" : ""}`}>{children}</div>
        {aside && <div className="flex flex-col gap-4 lg:col-span-2 lg:min-h-0">{aside}</div>}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        <Link href={`/dashboard/products/${merchantId}`}>
          <Button variant="ghost" size="sm">
            Product overview
          </Button>
        </Link>
        {next && (
          <Link href={next.href}>
            <Button>
              {next.label}
              <ArrowRight />
            </Button>
          </Link>
        )}
      </footer>
    </div>
  );
}

/**
 * A titled block inside a setup screen, matching the panels on the product page
 * so the two never look like they came from different apps.
 */
export function SetupPanel({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col rounded-(--radius-xl) border border-border/70 bg-card [background-image:var(--card-surface)] shadow-[var(--edge-light),var(--shadow-sm)] lg:min-h-0 ${className}`}
    >
      {title && (
        <div className="shrink-0 px-4 pt-3.5 pb-2.5">
          <h2 className="font-heading text-sm font-semibold tracking-tight">{title}</h2>
        </div>
      )}
      <div className={`flex flex-1 flex-col px-4 lg:min-h-0 ${title ? "pb-4" : "py-4"}`}>
        {children}
      </div>
    </section>
  );
}
