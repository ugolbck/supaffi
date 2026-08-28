"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { updatePayoutDetailsAction } from "./updatePayoutDetails";

type FormState = { error?: string; saved?: boolean };

async function submit(_prevState: FormState, formData: FormData): Promise<FormState> {
  const value = String(formData.get("payoutDetails") ?? "");
  const result = await updatePayoutDetailsAction(value);
  if (result.error) return { error: result.error };
  return { saved: true };
}

export function PayoutDetailsForm({ initial }: { initial: string }) {
  const [state, formAction] = useActionState(submit, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payout details</CardTitle>
        <CardDescription>
          PayPal email, bank details — whatever the Merchant pays you with. They read this
          manually when it's time to pay you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3">
          <Textarea
            name="payoutDetails"
            defaultValue={initial}
            rows={3}
            placeholder="e.g. PayPal: you@example.com"
          />
          {state.error && (
            <p role="alert" className="text-sm text-status-danger">
              {state.error}
            </p>
          )}
          {state.saved && <p className="text-sm text-status-success">Saved.</p>}
          <Button type="submit" className="self-start">
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
