"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmFraudAction } from "./confirmFraud";

export function ConfirmFraudButton({
  merchantId,
  commissionId,
}: {
  merchantId: string;
  commissionId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await confirmFraudAction(merchantId, commissionId);
          if ("error" in result) {
            toast.error(result.error);
          } else {
            toast.success("Commission voided");
            router.refresh();
          }
        });
      }}
    >
      Confirm fraud
    </Button>
  );
}
