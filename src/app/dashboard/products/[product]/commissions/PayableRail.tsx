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
        <ul className="flex flex-col gap-1">
          {groups.map((group) => (
            <li
              key={`${group.affiliateId}:${group.currency}`}
              className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm"
            >
              <Link
                href={group.href}
                className="min-w-0 flex-1 cursor-pointer truncate font-medium hover:underline"
              >
                {group.affiliateName ?? group.affiliateEmail}
              </Link>
              <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                {group.total} {group.currency.toUpperCase()}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 cursor-pointer px-2 text-xs"
                disabled={isPending}
                onClick={() => pay(group)}
              >
                Pay
              </Button>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
