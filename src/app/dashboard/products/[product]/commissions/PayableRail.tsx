"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardCard, CardEmpty } from "@/components/dashboard/DashboardCard";
import type { PayableGroup } from "@/lib/analytics";
import { markPaidAction } from "./markPaid";

/** A payable group plus the one link into the filtered ledger for its affiliate. */
export type PayableRailGroup = PayableGroup & {
  /** Built server-side: a function prop can't cross the server/client boundary. */
  href: string;
};

/**
 * The old Payouts tab, reframed as the ledger's rail: what is ready to pay,
 * one row per affiliate per currency.
 *
 * Each group carries the exact commission ids `getPayableGroups` read at
 * render time. Pay submits those ids, never a re-query, so a commission that
 * crosses its holding-period boundary between paint and click cannot get
 * swept into a payout nobody decided to make (CONTEXT.md; PAID is terminal).
 */
export function PayableRail({
  merchantId,
  groups,
  className = "",
}: {
  merchantId: string;
  groups: PayableRailGroup[];
  className?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function pay(group: PayableGroup) {
    startTransition(async () => {
      const result = await markPaidAction(merchantId, group.commissionIds);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Marked ${result.count} commission${result.count === 1 ? "" : "s"} as paid`
      );
      router.refresh();
    });
  }

  return (
    <DashboardCard title="Ready to pay" className={className} bodyScrolls>
      {groups.length === 0 ? (
        <CardEmpty icon={HandCoins} title="No money has cleared its holding period" />
      ) : (
        // Rows share the card's height rather than stacking at the top, so
        // one payable affiliate fills the rail as completely as six do.
        // `min-h-11` keeps a long list readable, at which point the body
        // scrolls instead of squashing every row.
        <ul className="flex flex-1 flex-col">
          {groups.map((group) => {
            // A refund can land after everything it claws back is already
            // PAID, leaving a lone negative row. It is a real balance and has
            // to be shown, but there is nothing to pay: the mutation refuses
            // a negative total, so a Pay button here could only ever fail
            // (CONTEXT.md; the balance carries to the next payout).
            const carries = Number(group.total) < 0;
            return (
              <li
                key={`${group.affiliateId}:${group.currency}`}
                className="flex min-h-14 flex-1 flex-col justify-center gap-1 border-b border-border/50 py-2 text-sm last:border-0"
              >
                <Link
                  href={group.href}
                  className="cursor-pointer truncate font-medium hover:underline"
                >
                  {group.affiliateName ?? group.affiliateEmail}
                </Link>
                {/* Amount and action on their own line: at rail width one line
                    could not hold a name, a figure and a button without
                    truncating the name down to a letter. */}
                <div className="flex items-center gap-2">
                  <span
                    className={`shrink-0 font-mono text-xs tabular-nums ${
                      carries ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {group.total} {group.currency.toUpperCase()}
                  </span>
                  <span className="flex-1" />
                  {carries ? (
                    <span className="shrink-0 text-xs text-muted-foreground">Carries forward</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 cursor-pointer px-2 text-xs"
                      disabled={isPending}
                      onClick={() => pay(group)}
                    >
                      Pay
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}
