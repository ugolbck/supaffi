import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Step } from "@/lib/onboarding";
import { stepPath } from "@/lib/onboarding";

// A row is a flex box the full width of the rail, so a clickable one is
// clickable everywhere, not just on its label.
function rowClass(state: Step["state"], clickable: boolean): string {
  return cn(
    "flex min-h-9 items-center gap-3 rounded-lg px-3 py-1.5 text-sm",
    state === "current" && "bg-accent-50 font-medium text-accent-700",
    state === "upcoming" && "text-muted-foreground/60",
    clickable && "cursor-pointer transition-colors hover:bg-black/[0.04]"
  );
}

// Steps already done are links, so someone can go back and change something.
// Upcoming steps are not: the order is the product.
export function Rail({ steps, productSlug, backHref }: { steps: Step[]; productSlug: string | null; backHref: string | null }) {
  return (
    <aside className="w-64 shrink-0">
      {backHref && (
        <Link href={backHref} className="mb-6 block cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          &larr; Back to dashboard
        </Link>
      )}
      <ol className="flex flex-col gap-1">
        {steps.map((step) => {
          const clickable = productSlug !== null && (step.state === "done" || step.state === "waiting");
          return (
            <li key={step.id}>
              {clickable ? (
                <Link href={stepPath(productSlug, step.id)} className={rowClass(step.state, true)}>
                  <Marker state={step.state} />
                  <span className="truncate">{step.label}</span>
                </Link>
              ) : (
                <span className={rowClass(step.state, false)}>
                  <Marker state={step.state} />
                  <span className="truncate">{step.label}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function Marker({ state }: { state: Step["state"] }) {
  if (state === "done") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-status-success text-white">
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  // Reached, not green: a quiet tick rather than the success one, so the
  // green rows still read as the progress and this one reads as at rest
  // without claiming a light it has not earned.
  if (state === "waiting") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-neutral-400 text-white">
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (state === "current") return <span className="size-4 shrink-0 rounded-full border-2 border-accent-700" />;
  return <span className="size-4 shrink-0 rounded-full border border-border" />;
}
