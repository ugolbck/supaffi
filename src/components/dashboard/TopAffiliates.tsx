import Link from "next/link";
import type { TopAffiliate } from "@/lib/analytics";
import { formatCount, money, moneyHint, prefer } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Who is doing the work, for the window the page is showing.
 *
 * Ranked, and the ranking is drawn rather than numbered: under each row a
 * thin bar runs as far as that affiliate's share of the leader, so the gap
 * between first and fifth is a shape the eye takes in before it reads a
 * single figure. No badges, no medals. The row itself carries the rank in a
 * small numeral set in the margin, where it labels without decorating.
 */
export function TopAffiliates({
  affiliates,
  currency,
  viewAllHref,
  className,
}: {
  affiliates: TopAffiliate[];
  /** The currency the page is drawn in. Leads every figure here too. */
  currency: string | null;
  viewAllHref: string;
  className?: string;
}) {
  const ranked = affiliates.map((a) => ({ ...a, earned: prefer(a.earned, currency) }));
  // The bar compares leading-currency amounts, which is a shape and not a
  // sum: money is never added across currencies. The figure itself is
  // printed per currency beside it.
  const leader = Math.max(0, ...ranked.map((a) => Number(a.earned[0]?.total ?? 0)));

  return (
    <section
      className={cn(
        "@container flex min-h-0 flex-col rounded-(--radius-md) border border-(--card-hairline) bg-elevated shadow-(--shadow-raised)",
        className
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-4 pb-2">
        <h2 className="text-sm font-medium">Top affiliates</h2>
        <Button variant="secondary" size="sm" render={<Link href={viewAllHref} />}>
          View all
        </Button>
      </div>

      {ranked.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-5 pb-6 text-[13px] text-muted-foreground">
          No sales in this period yet
        </p>
      ) : (
        <ol className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-3">
          {ranked.map((affiliate, index) => {
            const first = Number(affiliate.earned[0]?.total ?? 0);
            const share = leader > 0 ? Math.max(0.04, first / leader) : 0;
            const hint = moneyHint(affiliate.earned);
            return (
              <li
                key={affiliate.id}
                className="flex flex-col gap-2 border-b border-neutral-200 py-3 last:border-0"
              >
                <div className="flex items-baseline gap-3">
                  <span className="w-4 shrink-0 text-[11px] font-medium text-neutral-400 tabular-nums">
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={cn("truncate text-sm", index === 0 ? "font-semibold" : "font-medium")}>
                      {affiliate.name ?? affiliate.email}
                    </span>
                    <span className="truncate text-[12px] text-muted-foreground tabular-nums">
                      {formatCount(affiliate.sales)} {affiliate.sales === 1 ? "sale" : "sales"}
                      {/* Clicks only where the row has room for both figures. */}
                      <span className="hidden @min-[320px]:inline">
                        {" · "}
                        {formatCount(affiliate.clicks)} {affiliate.clicks === 1 ? "click" : "clicks"}
                      </span>
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <span className="text-sm font-semibold tabular-nums">{money(affiliate.earned)}</span>
                    {hint && <span className="text-[11px] text-muted-foreground tabular-nums">{hint}</span>}
                  </div>
                </div>
                <div className="ml-7 h-1 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className={cn("h-full rounded-full", index === 0 ? "bg-accent-600" : "bg-accent-300")}
                    style={{ width: `${Math.round(share * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
