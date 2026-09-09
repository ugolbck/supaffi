"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProductAction } from "./productAction";

export function ProductForm() {
  const [state, action, pending] = useActionState(createProductAction, { error: "" });
  return (
    <form action={action} className="flex flex-col gap-5">
      {state.error && <p role="alert" className="text-sm text-status-danger">{state.error}</p>}
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Product name</Label>
        <Input id="name" name="name" required autoFocus placeholder="InstantGradient" />
        <p className="text-xs text-muted-foreground">Affiliates see this.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="websiteUrl">Website</Label>
        <Input id="websiteUrl" name="websiteUrl" type="url" required placeholder="https://instantgradient.com" />
        <p className="text-xs text-muted-foreground">Where referral links send people.</p>
      </div>
      <div>
        <Button type="submit" size="lg" className="cursor-pointer" disabled={pending}>
          Continue
        </Button>
      </div>
    </form>
  );
}
