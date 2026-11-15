"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Looks for the domain's verification record now, beside its row in the lights. */
export function VerifyDomainButton({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action}>
      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" className="cursor-pointer" disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {pending ? "Checking" : "Check"}
    </Button>
  );
}
