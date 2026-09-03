import type { AffiliateCommissionRow, AffiliateCommissionStatus } from "@/lib/affiliate";
import type { AffiliateLinkStats } from "@/lib/affiliateLink";
import { linkUrl } from "@/lib/affiliateLink";
import type { CurrencyTotal } from "@/lib/analytics";
import { money, moneyHint } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { LedgerScroller, LEDGER_ROW_HEIGHT } from "@/components/dashboard/LedgerScroller";

/**
 * The three card bodies the Overview is built from.
 *
 * Split out of the page so the page stays a layout: what fetches, what goes in
 * which cell, and which card is empty. Both treatments here are the owner
 * overview's, so the two dashboards read the same: links use its Programs
 * panel, commissions use its distributed rows.
 */

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// FLAGGED never reaches an Affiliate: toDisplayStatus folds it into PENDING
// before a row gets here, so there are four states, not five. Exported because
// the commissions ledger shows the same four and a second copy of them would
// drift.
export const STATUS_STYLES: Record<AffiliateCommissionStatus, string> = {
  PENDING: "bg-muted text-muted-foreground",
  PAYABLE: "bg-status-success-bg text-status-success",
  PAID: "bg-accent-100 text-accent-800",
  VOIDED: "bg-muted text-muted-foreground line-through",
};

export const STATUS_LABELS: Record<AffiliateCommissionStatus, string> = {
  PENDING: "Pending",
  PAYABLE: "Payable",
  PAID: "Paid",
  VOIDED: "Voided",
};

/**
 * When the money arrives, which is the first thing an Affiliate asks a row.
 * The one copy of this label: the Overview cards and the Commissions ledger
 * both import it, rather than keeping their own that can drift apart.
 */
export function commissionStateLabel(row: AffiliateCommissionRow): string {
  switch (row.status) {
    case "PENDING": {
      // FLAGGED folds into PENDING and the sweep deliberately never
      // promotes a flagged row, so its payableAt can sit in the past
      // indefinitely. Once that date has passed, naming it reads as a bug
      // ("Clears 14 Aug" in September); this is honest for both a row
      // genuinely waiting on the next sweep and a concealed flagged one.
      if (row.payableAt.getTime() <= Date.now()) return "Clearing shortly";
      return `Clears ${DATE.format(row.payableAt)}`;
    }
    case "PAYABLE":
      // An adjustment is a negative clawback netting against the next
      // payout, not new money on its way to the Affiliate.
      return row.isAdjustment ? "Refund adjustment, comes off your next payout" : "Ready to pay";
    case "PAID":
      return row.paidAt ? `Paid ${DATE.format(row.paidAt)}` : "Paid";
    case "VOIDED":
      // A void is either a refund or a confirmed self-referral and the row
      // does not carry which, so it does not claim one.
      return "Voided";
  }
}

/**
 * One panel per link, sharing the card's height.
 *
 * The owner's Programs card, which has the same problem: exactly one item on
 * day one, and the item's point is a URL somebody has to share. Ruled rows
 * would centre a single line of grey text in a tall card, so each link gets
 * what it is actually for instead, the shareable URL and the button that
 * copies it, with its counts above.
 */
export function LinkRows({
  links,
  websiteUrl,
}: {
  links: AffiliateLinkStats[];
  websiteUrl: string;
}) {
  return (
    <div className="flex flex-1 flex-col gap-2">
      {links.map((link) => {
        const url = linkUrl(websiteUrl, link);
        return (
          <div
            key={link.id}
            // justify-between, not the Programs card's justify-center: an
            // Affiliate has one link far more often than an Owner has one
            // program, and centring 76px of content in a 164px panel is the
            // pooling this card was rewritten to remove.
            className="flex flex-1 flex-col justify-between gap-1.5 rounded-lg border border-border/70 bg-background/60 p-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{link.code}</span>
              {link.isPrimary && <Badge variant="outline">Primary</Badge>}
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {link.clicks} clk · {link.conversions} conv · {money(link.earned)}
            </span>
            <div className="flex items-center justify-between gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {url}
              </code>
              <CopyLinkButton size="sm" link={url} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Rows as a ruled ledger, the same technique `LinksTable`, `CommissionLedger`
 * and `PaymentRows` (payouts/page.tsx) use: fixed-height rows plus
 * `LedgerScroller`'s filler picking up the rhythm below the last one. A
 * `flex-1` row used to do this instead, sharing the card's height between
 * rows — that reads fine at ten rows but at exactly one commission the sole
 * `li` stretched to the whole card and centred its one line in the middle,
 * real dead space above and below rather than a full card (the same bug
 * `PaymentRows` had at one payment). The amount is the row's one full-size
 * element; date, state and status are its supporting detail.
 */
export function CommissionRows({ rows }: { rows: AffiliateCommissionRow[] }) {
  return (
    <LedgerScroller>
      <ul>
        {rows.map((row) => (
          <li
            key={row.id}
            className={`flex items-center gap-2.5 border-b border-border/50 px-4 text-sm ${LEDGER_ROW_HEIGHT}`}
          >
            <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">
              {DATE.format(row.createdAt)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {commissionStateLabel(row)}
            </span>
            <span
              className={`shrink-0 font-mono text-sm tabular-nums ${row.isAdjustment ? "text-destructive" : ""}`}
            >
              {row.amount} {row.currency.toUpperCase()}
            </span>
            <Badge className={STATUS_STYLES[row.status]}>{STATUS_LABELS[row.status]}</Badge>
          </li>
        ))}
      </ul>
    </LedgerScroller>
  );
}

/**
 * What is on file, and what is waiting on it.
 *
 * The details are freeform text a Merchant pays against, so they get the height
 * of the card rather than a truncated line, and the payable total sits above
 * them because that is the money those details are for.
 */
export function PayoutSummary({
  details,
  payable,
}: {
  details: string;
  payable: CurrencyTotal[];
}) {
  const hint = moneyHint(payable);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-border/50 pb-2.5">
        <span className="text-xs font-medium text-muted-foreground">Ready to pay</span>
        <span className="flex flex-col items-end gap-0.5">
          <span
            className={`font-mono text-sm tabular-nums ${
              payable.length > 0 ? "text-status-success" : "text-muted-foreground"
            }`}
          >
            {money(payable)}
          </span>
          {hint && (
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{hint}</span>
          )}
        </span>
      </div>
      <p className="min-h-0 flex-1 overflow-y-auto rounded-(--radius-lg) bg-muted/50 p-2.5 font-mono text-xs break-words whitespace-pre-wrap">
        {details}
      </p>
    </div>
  );
}
