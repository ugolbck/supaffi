"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { dismissFlagAction } from "./dismissFlag";

export function DismissFlagButton({
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
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await dismissFlagAction(merchantId, commissionId);
          if ("error" in result) {
            toast.error(result.error);
          } else {
            toast.success("Flag dismissed");
            router.refresh();
          }
        });
      }}
    >
      Dismiss
    </Button>
  );
}
