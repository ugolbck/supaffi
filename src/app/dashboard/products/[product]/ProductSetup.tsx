import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { Check, Code, Percent, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setupSteps, type ProductSetup as Setup, type SetupStepId } from "@/lib/productSetup";

function Term({ word, children }: { word: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="cursor-help underline decoration-dashed decoration-from-font underline-offset-4" />
        }
      >
        {word}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72 leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

const STEP_ICON: Record<SetupStepId, ComponentType<{ className?: string }>> = {
  integrations: Plug,
  program: Percent,
  tracking: Code,
};

// Tailwind can't see a dynamically built class string, so the column count
// has to come from a lookup rather than `grid-cols-${steps.length}`. Keyed on
// the step count rather than hardcoded to 3, so the step rail can't silently
// break the way it already did once (four steps, then three).
const STEPPER_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
};

/**
 * Setup for one product, as a horizontal stepper filling its own band.
 *
 * Rendered only while setup is unfinished, so exactly one step is ever
 * current: the first one not yet done. Done steps collapse to a tick and
 * their label, because there is nothing left to say about them; the current
 * step is the only one that spends the row's height, on its body text and its
 * one action.
 *
 * Steps after the current one are dimmed but never disabled, same as the
 * checklist this replaces: the order is a recommendation, not a lock.
 */
export function ProductSetup({
  productSlug,
  setup,
  className = "",
}: {
  productSlug: string;
  setup: Setup;
  className?: string;
}) {
  const base = `/dashboard/products/${productSlug}`;
  const steps = setupSteps(productSlug, setup);
  const currentIndex = steps.findIndex((step) => !step.done);

  const body: Record<SetupStepId, ReactNode> = {
    integrations: setup.emailRequired
      ? "Your payment provider, and the email that sends affiliates their login links."
      : "Your payment provider. Login links are printed to the terminal on this instance.",
    program: (
      <>
        How much affiliates earn per sale, for how long, and the{" "}
        <Term word="holding period">
          How long a commission stays pending before you can pay it out. Long enough for a
          refund or chargeback to land first.
        </Term>
        .
      </>
    ),
    // The current step is only ever tracking while it is not-started: once a
    // click has arrived the step already counts as done and collapses to a
    // tick, so there is no "waiting on a sale" body text to write here.
    tracking:
      "Two snippets on your own site: one records the click, one tells Stripe which affiliate sent the sale.",
  };

  const action: Record<SetupStepId, ReactNode> = {
    integrations: (
      <Link href={`${base}/integrations`}>
        <Button size="sm" className="cursor-pointer">
          Connect
        </Button>
      </Link>
    ),
    program: (
      <Link href={`${base}/programs/new`}>
        <Button size="sm" className="cursor-pointer">
          Set terms
        </Button>
      </Link>
    ),
    tracking: (
      <Link href={`${base}/tracking`}>
        <Button size="sm" className="cursor-pointer">
          Install tracking
        </Button>
      </Link>
    ),
  };

  return (
    <section
      className={`flex h-full min-h-0 flex-col rounded-(--radius-xl) border border-border/70 bg-card [background-image:var(--card-surface)] p-4 shadow-[var(--edge-light),var(--shadow-sm)] ${className}`}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 pb-3">
        <h2 className="font-heading text-sm font-semibold tracking-tight">Finish setting up</h2>
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          {setup.doneCount} of {setup.totalSteps}
        </span>
      </div>

      <div className={`grid min-h-0 flex-1 ${STEPPER_COLUMNS[steps.length] ?? "grid-cols-3"}`}>
        {steps.map((step, i) => {
          const isDone = step.done;
          const isCurrent = i === currentIndex;
          const Icon = STEP_ICON[step.id];

          return (
            <div
              key={step.id}
              className="flex h-full min-w-0 animate-in flex-col items-center justify-center gap-3 fade-in slide-in-from-bottom-1 px-4 text-center duration-300 ease-[var(--ease-out)] fill-mode-both"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="relative flex w-full shrink-0 items-center justify-center py-1">
                {/* Half a line from the circle to each neighbour. The circle
                    sits above it (z-10) so the line reads as unbroken. */}
                {i > 0 && (
                  <span className="absolute top-1/2 right-1/2 h-px w-full -translate-y-1/2 bg-border" />
                )}
                {i < steps.length - 1 && (
                  <span className="absolute top-1/2 left-1/2 h-px w-full -translate-y-1/2 bg-border" />
                )}
                <span
                  className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full shadow-[var(--edge-light)] ${
                    isDone
                      ? "bg-status-success text-white"
                      : isCurrent
                        ? "bg-accent-500 text-white"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isDone ? <Check className="size-4" strokeWidth={3} /> : <Icon className="size-4" />}
                </span>
              </div>

              {isCurrent ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5">
                  <h3 className="text-sm font-semibold tracking-tight">{step.label}</h3>
                  <p className="max-w-64 text-xs leading-relaxed text-muted-foreground">
                    {body[step.id]}
                  </p>
                  {action[step.id]}
                </div>
              ) : (
                <span
                  className={`text-sm font-medium ${isDone ? "text-muted-foreground" : "text-muted-foreground/60"}`}
                >
                  {step.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
