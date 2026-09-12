import { Button } from "@/components/ui/button";
import type { PayableGroup } from "@/lib/analytics";
import { markPaidAction } from "./commissionActions";

/**
 * What can be paid right now, as a list.
 *
 * One row per affiliate and currency, because that is what a payout is: the
 * ledger refuses a write that spans either, and money is never summed across
 * currencies. An affiliate owed in two currencies is owed two payouts, and
 * this is where that is visible rather than a rule they meet as an error.
 *
 * A list rather than a row of buttons. As buttons the whole thing was one
 * wrapping line of "Mark 4 as paid, 120.00 USD", which at six affiliates in
 * two currencies ran off the screen and left no way to compare one payout
 * with the next. Rows put the names in a column, the amounts in a column,
 * and the actions in a column, and the card holds its height however many
 * there are.
 *
 * Each row carries the exact commission ids read at render time, never a
 * re-query at write time, so a commission that clears its holding period
 * between paint and click cannot be swept into a payout nobody decided to
 * make.
 */
export function PayBar({
  product,
  groups,
  listHref,
}: {
  product: { id: string; slug: string };
  groups: PayableGroup[];
  /** The list as it is being read, so a payout lands back on this same tab. */
  listHref: string;
}) {
  if (groups.length === 0) return null;

  const payouts = groups.filter((group) => Number(group.total) >= 0).length;

  return (
    <section className="flex max-h-[260px] shrink-0 flex-col overflow-hidden rounded-(--radius-md) border border-(--card-hairline) bg-elevated shadow-(--shadow-raised)">
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <h2 className="font-heading text-sm font-semibold tracking-tight">Ready to pay</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {payouts === 1 ? "1 payout" : `${payouts} payouts`}
        </span>
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-neutral-200 overflow-y-auto border-t border-neutral-200">
        {groups.map((group) => {
          const name = group.affiliateName ?? group.affiliateEmail;
          const amount = `${group.total} ${group.currency.toUpperCase()}`;
          const count = group.commissionIds.length;

          // A refund can land after everything it claws back is already paid,
          // leaving a lone negative balance. There is nothing to pay, so
          // there is no button: it carries to the next payout.
          if (Number(group.total) < 0) {
            return (
              <li
                key={`${group.affiliateId}:${group.currency}`}
                className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-muted-foreground"
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="shrink-0 tabular-nums">
                  owes {amount.replace("-", "")} back, carried to the next payout
                </span>
              </li>
            );
          }

          return (
            <li key={`${group.affiliateId}:${group.currency}`}>
              <form
                action={markPaidAction.bind(null, listHref, product, group.commissionIds)}
                className="flex items-center gap-3 px-4 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {count === 1 ? "1 commission" : `${count} commissions`}
                </span>
                <span className="w-28 shrink-0 text-right text-sm font-semibold tabular-nums">
                  {amount}
                </span>
                <Button type="submit" size="sm" variant="secondary" className="shrink-0">
                  Mark paid
                </Button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
