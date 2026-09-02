"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getPayoutDetailAction } from "./getPayoutDetail";
import type { PayoutCommissionLine } from "@/lib/commission";

export function PayoutDetailDialog({
  merchantId,
  affiliateId,
  affiliateName,
  currency,
}: {
  merchantId: string;
  affiliateId: string;
  affiliateName: string;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<PayoutCommissionLine[] | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && lines === null) {
          getPayoutDetailAction(merchantId, affiliateId, currency).then(setLines);
        }
      }}
    >
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        View details
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {affiliateName} ({currency.toUpperCase()})
          </DialogTitle>
          <DialogDescription>Commissions included in this payout.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {lines === null ? (
            <>
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </>
          ) : lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No commissions found.</p>
          ) : (
            lines.map((line) => (
              <div key={line.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  {new Date(line.createdAt).toLocaleDateString()}
                  {line.stripePaymentRef && (
                    <span className="font-mono text-xs text-muted-foreground/70">
                      {line.stripePaymentRef}
                    </span>
                  )}
                </span>
                <span className="font-mono">
                  {line.amount} {currency.toUpperCase()}
                </span>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
