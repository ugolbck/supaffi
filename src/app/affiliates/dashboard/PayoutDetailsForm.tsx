"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { updatePayoutDetailsAction } from "./updatePayoutDetails";

type FormState = { error?: string; saved?: boolean };

async function submit(_prevState: FormState, formData: FormData): Promise<FormState> {
  const value = String(formData.get("payoutDetails") ?? "");
  const result = await updatePayoutDetailsAction(value);
  if (result.error) return { error: result.error };
  return { saved: true };
}

/**
 * Sits inside a `DashboardCard` rather than carrying its own `Card`, so it
 * stretches with the rest of the band instead of sizing to its own content.
 *
 * `form` renders as `display: contents`: its child `DashboardCard` is what
 * the grid actually places and stretches (the `className` grid-span lands on
 * that card, same as every other card on this screen), while the form itself
 * still owns submission, so the Save button in the footer can reach the
 * textarea in the body even though they are card siblings.
 */
export function PayoutDetailsForm({ initial, className }: { initial: string; className?: string }) {
  const [state, formAction] = useActionState(submit, {});

  return (
    <form action={formAction} className="contents">
      <DashboardCard
        title="Payout details"
        className={className}
        footer={
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs" aria-live="polite">
              {state.error && (
                <span role="alert" className="text-status-danger">
                  {state.error}
                </span>
              )}
              {state.saved && <span className="text-status-success">Saved.</span>}
            </p>
            <Button type="submit" size="sm" className="cursor-pointer">
              Save
            </Button>
          </div>
        }
      >
        <Textarea
          name="payoutDetails"
          defaultValue={initial}
          placeholder="e.g. PayPal: you@example.com"
          className="flex-1 resize-none"
        />
      </DashboardCard>
    </form>
  );
}
