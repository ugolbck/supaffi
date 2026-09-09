import { Button } from "@/components/ui/button";
import type { PayableGroup } from "@/lib/analytics";
import { markPaidAction } from "./commissionActions";

/**
 * What can be paid right now, under the ledger, only while the payable tab is
 * on.
 *
 * One button per affiliate and currency, because that is what a payout is: the
 * ledger refuses a write that spans either, and money is never summed across
 * currencies. Each button carries the exact ids read at render time, never a
 * re-query at write time, so a commission that clears its holding period
 * between paint and click cannot be swept into a payout nobody decided to make.
 */
export function PayBar({
  product,
  groups,
}: {
  product: { id: string; slug: string };
  groups: PayableGroup[];
}) {
  if (groups.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
      {groups.map((group) => {
        const name = group.affiliateName ?? group.affiliateEmail;
        const amount = `${group.total} ${group.currency.toUpperCase()}`;

        // A refund can land after everything it claws back is already paid,
        // leaving a lone negative balance. There is nothing to pay, so there
        // is no button: it carries to the next payout.
        if (Number(group.total) < 0) {
          return (
            <p key={`${group.affiliateId}:${group.currency}`} className="text-[13px] text-muted-foreground">
              {name} owes {amount.replace("-", "")} back, carried to the next payout
            </p>
          );
        }

        return (
          <form
            key={`${group.affiliateId}:${group.currency}`}
            action={markPaidAction.bind(null, product, group.commissionIds)}
            className="flex items-center gap-2"
          >
            {groups.length > 1 && (
              <span className="max-w-40 truncate text-[13px] text-muted-foreground">{name}</span>
            )}
            <Button type="submit" size="sm" className="cursor-pointer">
              Mark {group.commissionIds.length} as paid, {amount}
            </Button>
          </form>
        );
      })}
    </div>
  );
}
