"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markPaidAction } from "./markPaid";

export function MarkPaidButton({
  merchantId,
  affiliateId,
  currency,
}: {
  merchantId: string;
  affiliateId: string;
  currency: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      type="button"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await markPaidAction(merchantId, affiliateId, currency);
          if ("error" in result) {
            toast.error(result.error);
          } else {
            toast.success(
              `Marked ${result.count} commission${result.count === 1 ? "" : "s"} as paid`
            );
            router.refresh();
          }
        });
      }}
    >
      Mark paid
    </Button>
  );
}
