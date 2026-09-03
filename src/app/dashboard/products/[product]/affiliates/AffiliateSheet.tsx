"use client";

import Link from "next/link";
import type { CommissionStatus } from "@/lib/commission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * One affiliate, opened from a row.
 *
 * A sheet rather than a route, so the list keeps its filters, its page and its
 * scroll position behind it. Read-only: reassigning a program and overriding a
 * rate are writes, and they belong with the rest of the affiliate mutations
 * rather than bolted onto a panel that exists to answer "who is this".
 */

export type SheetCommission = {
  id: string;
  amount: string;
  currency: string;
  status: CommissionStatus;
  /** Pre-formatted on the server, so both sides render the same date. */
  dateLabel: string;
};

export type AffiliateRowView = {
  id: string;
  name: string | null;
  email: string;
  referralCode: string;
  programName: string;
  programHref: string;
  clicks: number;
  conversions: number;
  earned: string;
  earnedHint: string | null;
  /** Already carries its percent sign. */
  rate: string;
  rateIsOverride: boolean;
  joinedLabel: string;
  referralLink: string;
  payoutDetails: string | null;
  commissions: SheetCommission[];
};

const STATUS_STYLES: Record<CommissionStatus, string> = {
  PENDING: "bg-muted text-muted-foreground",
  PAYABLE: "bg-status-success-bg text-status-success",
  FLAGGED: "bg-status-warning-bg text-status-warning",
  PAID: "bg-accent-100 text-accent-800",
  VOIDED: "bg-muted text-muted-foreground line-through",
};

const STATUS_LABELS: Record<CommissionStatus, string> = {
  PENDING: "Pending",
  PAYABLE: "Payable",
  FLAGGED: "Flagged",
  PAID: "Paid",
  VOIDED: "Voided",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-(--radius-lg) border border-border/70 bg-elevated [background-image:var(--elevated-surface)] px-3 py-2.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="font-heading truncate text-base leading-tight font-semibold tracking-tight tabular-nums">
        {value}
      </span>
      {hint && (
        <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
          {hint}
        </span>
      )}
    </div>
  );
}

export function AffiliateSheet({
  row,
  open,
  onOpenChange,
}: {
  row: AffiliateRowView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!row) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:sm:max-w-md">
        <SheetHeader className="shrink-0 border-b border-border/60 pr-12">
          <SheetTitle className="truncate">{row.name ?? row.email}</SheetTitle>
          <SheetDescription className="truncate">{row.email}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Clicks" value={String(row.clicks)} />
            <Metric label="Conversions" value={String(row.conversions)} />
            <Metric label="Earned" value={row.earned} hint={row.earnedHint} />
          </div>

          <Field label="Referral link">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                {row.referralLink}
              </code>
              <CopyLinkButton size="sm" link={row.referralLink} />
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Program">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{row.programName}</span>
                <Link href={row.programHref}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 cursor-pointer px-1.5 text-xs text-muted-foreground"
                  >
                    Terms
                  </Button>
                </Link>
              </div>
            </Field>
            <Field label="Rate">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm tabular-nums">{row.rate}</span>
                <Badge variant="outline" className="text-[11px]">
                  {row.rateIsOverride ? "Override" : "Program default"}
                </Badge>
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Referral code">
              <span className="truncate font-mono text-sm">{row.referralCode}</span>
            </Field>
            <Field label="Joined">
              <span className="text-sm tabular-nums">{row.joinedLabel}</span>
            </Field>
          </div>

          <Field label="Payout details">
            <p className="rounded-md bg-muted px-2 py-1.5 text-sm break-words whitespace-pre-wrap text-muted-foreground">
              {row.payoutDetails ?? "None"}
            </p>
          </Field>

          <Field label="Recent commissions">
            {row.commissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {row.commissions.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-sm"
                  >
                    <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
                      {c.dateLabel}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-sm tabular-nums">
                      {c.amount} {c.currency.toUpperCase()}
                    </span>
                    <Badge className={`shrink-0 ${STATUS_STYLES[c.status]}`}>
                      {STATUS_LABELS[c.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Field>
        </div>
      </SheetContent>
    </Sheet>
  );
}
