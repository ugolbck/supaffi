"use client";

import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CommissionStatus } from "@/lib/commission";
import { voidReasonText, flagReasonText } from "@/lib/commissionReason";
import {
  markPaidAction,
  confirmFraudAction,
  dismissFlagAction,
  voidAction,
} from "./commissionActions";

/**
 * One commission in detail, and the one action that fits the state it is in.
 *
 * The list selects with `?commission=<id>` and the panel is rendered on the
 * server from that row, so there is no client copy of a commission to keep in
 * step with a write. Closing is a navigation back to the list, which is why
 * the URL it returns to arrives as a prop: the filters and the page were
 * already in it.
 */

export type SheetCommission = {
  id: string;
  status: CommissionStatus;
  /** Already carries its currency, since amounts are never converted. */
  amount: string;
  /** What this commission was before a partial refund reduced it. Null when unchanged. */
  grossAmount: string | null;
  affiliate: string;
  affiliateEmail: string;
  createdLabel: string;
  payableLabel: string;
  /** When a voided commission was voided. */
  voidedLabel: string | null;
  /** Internal token from the worker or an owner's own note, rendered through voidReasonText. */
  voidReason: string | null;
  /** Internal token from fraud detection, rendered through flagReasonText. */
  flagReason: string | null;
  /** What it is waiting on, or what happened to it. */
  stateLabel: string;
  /** When the click this sale was attributed to happened. */
  clickLabel: string;
  /** The link that click came through, when it still has one. */
  linkLabel: string | null;
  reference: { text: string; href: string | null } | null;
};

const STATUS_LABELS: Record<CommissionStatus, string> = {
  PENDING: "Pending",
  PAYABLE: "Payable",
  FLAGGED: "Flagged",
  PAID: "Paid",
  VOIDED: "Voided",
};

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-60 text-right break-words">{children}</span>
    </div>
  );
}

/** A labelled value, half of an evidence or before/after pair. */
function Figure({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  /** The "before" half of a pair, de-emphasised next to the current figure. */
  muted?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] font-medium tracking-wide text-neutral-500 uppercase">{label}</span>
      <span
        className={cn(
          "truncate font-mono text-[13px]",
          muted ? "text-neutral-500 line-through" : "font-semibold text-neutral-900"
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function CommissionSheet({
  commission,
  product,
  listHref,
}: {
  commission: SheetCommission;
  product: { id: string; slug: string };
  listHref: string;
}) {
  const router = useRouter();

  const flag = commission.status === "FLAGGED" ? flagReasonText(commission.flagReason) : null;
  const voidCause = commission.status === "VOIDED" ? voidReasonText(commission.voidReason, "owner") : null;
  const reduced = commission.status !== "VOIDED" && commission.grossAmount !== null;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(listHref);
      }}
    >
      {/* A floating panel over the scrim, not a flush edge-to-edge pane: the
          inset, radius and border are what separate it from the page behind
          it, the same "floating panel" treatment the design system gives any
          surface that sits over the canvas rather than in it. */}
      <SheetContent className="w-[420px] gap-0 overflow-y-auto bg-white p-0 shadow-xl data-[side=right]:inset-y-3 data-[side=right]:right-3 data-[side=right]:h-[calc(100%-1.5rem)] data-[side=right]:rounded-(--radius-lg) data-[side=right]:border data-[side=right]:border-neutral-200 data-[side=right]:sm:max-w-[420px]">
        <SheetHeader className="gap-1 border-b border-neutral-200 bg-neutral-50 px-5 py-4 pr-12">
          <SheetTitle className="text-xl font-semibold tabular-nums text-neutral-900">
            {commission.amount}
          </SheetTitle>
          <SheetDescription className="truncate">
            {commission.affiliate} · {commission.createdLabel}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-5 py-5">
          {/* The owner is being asked to accuse someone: the evidence comes
              before the confirm/dismiss controls, never after. */}
          {flag && (
            <div className="flex flex-col gap-3 rounded-(--radius-md) border border-status-warning/30 bg-status-warning-bg px-4 py-3.5">
              <p className="text-sm font-medium text-neutral-900">{flag.title}</p>
              {flag.evidence.length === 2 && (
                <div className="grid grid-cols-2 gap-4">
                  {flag.evidence.map((entry) => {
                    const spaceAt = entry.indexOf(" ");
                    const label = entry.slice(0, spaceAt);
                    const value = entry.slice(spaceAt + 1);
                    return <Figure key={label} label={label} value={value} />;
                  })}
                </div>
              )}
            </div>
          )}

          {voidCause && (
            <div className="flex flex-col gap-0.5 rounded-(--radius-md) border border-neutral-200 bg-neutral-50 px-4 py-3.5">
              <p className="text-sm text-neutral-900">{voidCause}</p>
              {commission.voidedLabel && (
                <p className="text-[13px] text-muted-foreground">{commission.voidedLabel}</p>
              )}
            </div>
          )}

          {reduced && commission.grossAmount && (
            <div className="flex flex-col gap-3 rounded-(--radius-md) border border-neutral-200 bg-neutral-50 px-4 py-3.5">
              <p className="text-sm text-neutral-900">{voidReasonText(commission.voidReason, "owner")}</p>
              <div className="grid grid-cols-2 gap-4">
                <Figure label="What it was" value={commission.grossAmount} muted />
                <Figure label="What it is now" value={commission.amount} />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Line label="Affiliate">{commission.affiliateEmail}</Line>
            <Line label="Status">{STATUS_LABELS[commission.status]}</Line>
            {commission.status !== "VOIDED" && (
              <Line label="Payable on">{commission.payableLabel}</Line>
            )}
            <Line label="Sale">
              {commission.reference ? (
                commission.reference.href ? (
                  <a
                    href={commission.reference.href}
                    target="_blank"
                    rel="noreferrer"
                    className="cursor-pointer font-mono text-xs underline underline-offset-2"
                  >
                    {commission.reference.text}
                  </a>
                ) : (
                  <span className="font-mono text-xs">{commission.reference.text}</span>
                )
              ) : (
                <span className="text-muted-foreground">No reference</span>
              )}
            </Line>
            <Line label="Click">{commission.clickLabel}</Line>
            {commission.linkLabel && (
              <Line label="Link">
                <span className="font-mono text-xs">{commission.linkLabel}</span>
              </Line>
            )}
          </div>

          {commission.status === "PAYABLE" && (
            <form action={markPaidAction.bind(null, listHref, product, [commission.id])}>
              <Button type="submit" size="sm" className="cursor-pointer">
                Mark paid
              </Button>
            </form>
          )}

          {commission.status === "PENDING" && (
            // A reason, because a voided commission is read months later by
            // somebody asking why an affiliate was not paid for a sale.
            <form
              action={voidAction.bind(null, listHref, product, commission.id)}
              className="flex flex-col gap-2"
            >
              <span className="text-sm font-medium">Void this commission</span>
              <div className="flex gap-2">
                <Input name="reason" placeholder="Reason" maxLength={200} className="flex-1" />
                <Button type="submit" size="sm" variant="secondary" className="cursor-pointer">
                  Void
                </Button>
              </div>
            </form>
          )}

          {commission.status === "FLAGGED" && (
            <div className="flex gap-2">
              <form action={confirmFraudAction.bind(null, listHref, product, commission.id)}>
                <Button type="submit" size="sm" variant="destructive" className="cursor-pointer">
                  Confirm self referral
                </Button>
              </form>
              <form action={dismissFlagAction.bind(null, listHref, product, commission.id)}>
                <Button type="submit" size="sm" variant="secondary" className="cursor-pointer">
                  Dismiss flag
                </Button>
              </form>
            </div>
          )}

          {commission.status === "PAID" && (
            <p className="text-sm text-muted-foreground">{commission.stateLabel}</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
