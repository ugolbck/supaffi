import Link from "next/link";
import type { CommissionDurationType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { commissionLine } from "@/lib/programCommission";

/**
 * One Program, as a card that fills its cell: terms, reach, and the two ways
 * forward from here. Pulled out of the page (same split as ProductCard) so
 * the grid body stays about laying cards out, not about what is on one.
 */
export function ProgramCard({
  name,
  defaultCommissionRate,
  commissionDurationType,
  commissionDurationMonths,
  attributionWindowDays,
  holdingPeriodDays,
  affiliateCount,
  signupLink,
  editHref,
  affiliatesHref,
}: {
  name: string;
  defaultCommissionRate: number;
  commissionDurationType: CommissionDurationType;
  commissionDurationMonths: number | null;
  attributionWindowDays: number;
  holdingPeriodDays: number;
  affiliateCount: number;
  signupLink: string;
  editHref: string;
  affiliatesHref: string;
}) {
  return (
    <DashboardCard
      title={name}
      footer={
        <div className="flex gap-2">
          <Link href={editHref} className="flex-1">
            <Button variant="outline" size="sm" className="w-full cursor-pointer">
              Edit
            </Button>
          </Link>
          <Link href={affiliatesHref} className="flex-1">
            <Button variant="outline" size="sm" className="w-full cursor-pointer">
              View affiliates
            </Button>
          </Link>
        </div>
      }
    >
      {/* Centred rather than pinned to the top, same rule as ProductCard's
          middle section: it is what keeps one program's card from reading as
          a short stack of lines with a hole underneath. */}
      <div className="flex flex-1 flex-col justify-center gap-1.5">
        <p className="text-sm font-medium">
          {commissionLine(defaultCommissionRate, commissionDurationType, commissionDurationMonths)}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {attributionWindowDays}d attribution
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">{holdingPeriodDays}d holding</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {affiliateCount === 1 ? "1 affiliate" : `${affiliateCount} affiliates`}
        </p>
      </div>
      <div className="mt-3 flex shrink-0 items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-1.5 py-1 font-mono text-[11px] text-muted-foreground">
          {signupLink}
        </code>
        <CopyLinkButton size="sm" link={signupLink} />
      </div>
    </DashboardCard>
  );
}
