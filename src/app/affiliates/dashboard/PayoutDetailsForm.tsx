"use client";

import { useActionState, useId } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Section } from "@/components/dashboard/Page";
import { updatePayoutDetailsAction } from "./updatePayoutDetails";

type FormState = { error?: string; saved?: boolean };

async function submit(_prevState: FormState, formData: FormData): Promise<FormState> {
  const value = String(formData.get("payoutDetails") ?? "");
  const result = await updatePayoutDetailsAction(value);
  if (result.error) return { error: result.error };
  return { saved: true };
}

/**
 * Whatever the merchant pays against, in the affiliate's own words: a PayPal
 * address, an IBAN, a wallet. Freeform because no two merchants pay the same
 * way and Supaffi moves no money itself.
 *
 * The field is the onboarding field treatment (a white hairline surface, mono,
 * the accent focus ring) and the save action sits in the card's band, the way
 * every task card in the flow carries the one action it owns. The button
 * reaches the form by `form=` rather than by nesting, since the band and the
 * body are siblings.
 */
export function PayoutDetailsForm({
  initial,
  className,
}: {
  initial: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(submit, {});
  const formId = useId();

  // From the prop alone: the action revalidates the layout, so `initial`
  // arrives filled in after a save and the notice goes with it. Saving an
  // empty field leaves it up next to "Saved", which is the truth.
  const missing = initial.trim() === "";

  return (
    <Section
      title="Payout details"
      // The field takes the height of the card, so it matches the card beside
      // it and gives someone pasting an IBAN and a note room to see both.
      fill
      className={className}
      actions={
        <div className="flex items-center gap-2.5">
          {state.saved && (
            <span className="flex items-center gap-1 text-xs font-medium text-status-success">
              <Check className="size-3.5" />
              Saved
            </span>
          )}
          <Button type="submit" form={formId} size="sm" disabled={pending}>
            {pending ? "Saving" : "Save"}
          </Button>
        </div>
      }
    >
      <form id={formId} action={formAction} className="flex min-h-0 flex-1 flex-col gap-2.5">
        {/* The one consequence this screen has that nothing on it shows: an
            empty field means the merchant has nowhere to send the money. Said
            here, where it is fixed, and nowhere else. */}
        {missing && (
          <p className="shrink-0 rounded-(--radius) bg-status-warning-bg px-3 py-2 text-[13px] text-status-warning">
            Until this is filled in, your merchant has nowhere to send your money.
          </p>
        )}
        <Textarea
          name="payoutDetails"
          defaultValue={initial}
          aria-label="Payout details"
          placeholder={"PayPal: you@example.com\nor an IBAN, or whatever your merchant pays with"}
          className="min-h-40 flex-1 resize-none border-neutral-300 bg-white font-mono text-[13px] shadow-xs focus-visible:border-accent-400"
        />
        {state.error && (
          <p role="alert" className="shrink-0 text-[13px] text-status-danger">
            {state.error}
          </p>
        )}
      </form>
    </Section>
  );
}
