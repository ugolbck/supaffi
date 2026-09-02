import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Sparkline } from "@/components/charts/Sparkline";
import type { ProductSetup } from "@/lib/productSetup";

/**
 * One product, as a card that fills its cell whatever state it is in.
 *
 * Setup progress and live numbers share the card rather than replacing each
 * other, because a product two steps in still has clicks worth seeing, and a
 * finished product still has a shape.
 */
export function ProductCard({
  name,
  domain,
  slug,
  setup,
  clicks,
  series,
  index,
}: {
  name: string;
  domain: string;
  slug: string;
  setup: ProductSetup;
  clicks: number;
  series: number[];
  index: number;
}) {
  return (
    <Link
      href={`/dashboard/products/${slug}`}
      className="group/product flex h-full min-h-28 animate-in cursor-pointer flex-col gap-3 fill-mode-both rounded-(--radius-xl) border border-border/70 bg-card [background-image:var(--card-surface)] p-4 shadow-[var(--edge-light),var(--shadow-sm)] transition-[transform,box-shadow] duration-300 ease-[var(--ease-out)] fade-in slide-in-from-bottom-2 hover:-translate-y-0.5 hover:shadow-[var(--edge-light),var(--shadow-lg)] active:scale-[0.995]"
      style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
    >
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-heading truncate text-base font-semibold tracking-tight">
            {name}
          </span>
          <span className="truncate text-xs text-muted-foreground">{domain}</span>
        </div>
        {setup.complete ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-status-success-bg px-2 py-0.5 text-xs font-medium text-status-success">
            <Check className="size-3" strokeWidth={3} />
            Live
          </span>
        ) : (
          <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
            {setup.doneCount} of {setup.totalSteps}
          </span>
        )}
      </div>

      {/* Takes the middle of the card rather than sitting in it. A hairline
          in a tall card is what made the old overview read as empty. */}
      {setup.complete ? (
        <Sparkline points={series} area className="min-h-12 w-full flex-1 text-accent-500" />
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-2">
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent-500 transition-[width] duration-500 ease-[var(--ease-out)]"
              style={{ width: `${(setup.doneCount / setup.totalSteps) * 100}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {setup.doneCount === 0
              ? "Connect Stripe to get started"
              : setup.integrationsConnected && !setup.firstProgramSlug
                ? "Set your commission terms next"
                : "Install tracking to finish"}
          </p>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="truncate tabular-nums">
          {setup.affiliateCount === 1 ? "1 affiliate" : `${setup.affiliateCount} affiliates`}
          {setup.complete ? ` · ${clicks} clicks` : ""}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground opacity-0 transition-opacity duration-200 ease-[var(--ease-out)] group-hover/product:opacity-100">
          {setup.complete ? "Open" : "Finish setup"}
          <ArrowRight className="size-3" />
        </span>
      </div>
    </Link>
  );
}
