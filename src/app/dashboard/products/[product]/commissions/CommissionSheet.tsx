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
import type { CommissionStatus } from "@/lib/commission";
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
  affiliate: string;
  affiliateEmail: string;
  createdLabel: string;
  payableLabel: string;
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

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(listHref);
      }}
    >
      <SheetContent className="w-[420px] overflow-y-auto data-[side=right]:sm:max-w-[420px]">
        <SheetHeader className="pr-12">
          <SheetTitle className="tabular-nums">{commission.amount}</SheetTitle>
          <SheetDescription className="truncate">
            {commission.affiliate} · {commission.createdLabel}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-4">
          <div className="flex flex-col gap-2">
            <Line label="Affiliate">{commission.affiliateEmail}</Line>
            <Line label="Status">{STATUS_LABELS[commission.status]}</Line>
            <Line label="Payable on">{commission.payableLabel}</Line>
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
            <form action={markPaidAction.bind(null, product, [commission.id])}>
              <Button type="submit" size="sm" className="cursor-pointer">
                Mark paid
              </Button>
            </form>
          )}

          {commission.status === "PENDING" && (
            // A reason, because a voided commission is read months later by
            // somebody asking why an affiliate was not paid for a sale.
            <form
              action={voidAction.bind(null, product, commission.id)}
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
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{commission.stateLabel}</span>
              <div className="flex gap-2">
                <form action={confirmFraudAction.bind(null, product, commission.id)}>
                  <Button
                    type="submit"
                    size="sm"
                    variant="destructive"
                    className="cursor-pointer"
                  >
                    Confirm self referral
                  </Button>
                </form>
                <form action={dismissFlagAction.bind(null, product, commission.id)}>
                  <Button type="submit" size="sm" variant="secondary" className="cursor-pointer">
                    Dismiss flag
                  </Button>
                </form>
              </div>
            </div>
          )}

          {(commission.status === "PAID" || commission.status === "VOIDED") && (
            <p className="text-sm text-muted-foreground">{commission.stateLabel}</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
