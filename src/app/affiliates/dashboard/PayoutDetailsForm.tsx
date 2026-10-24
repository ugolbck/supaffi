"use client";

import { useActionState, useId, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Section } from "@/components/dashboard/Page";
import {
  PAYOUT_METHODS,
  composePayoutDetails,
  parsePayoutDetails,
  type PayoutMethod,
} from "@/lib/payoutMethod";
import { updatePayoutDetailsAction } from "./updatePayoutDetails";

const METHOD_LABELS = Object.fromEntries(
  Object.entries(PAYOUT_METHODS).map(([method, { label }]) => [method, label])
) as Record<PayoutMethod, string>;

type FormState = { error?: string; saved?: boolean };

async function submit(_prevState: FormState, formData: FormData): Promise<FormState> {
  const value = String(formData.get("payoutDetails") ?? "");
  const result = await updatePayoutDetailsAction(value);
  if (result.error) return { error: result.error };
  return { saved: true };
}

/**
 * Where the merchant sends the money: a method from a short list and the one
 * value it needs, stored as a single line the owner copies ("PayPal: a@b.com").
 * "Other" keeps the free text for anything the list does not name.
 *
 * The save action sits in the card's band, the way every task card in the
 * flow carries the one action it owns. The button reaches the form by
 * `form=` rather than by nesting, since the band and the body are siblings.
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
  const [method, setMethod] = useState<PayoutMethod>(() => parsePayoutDetails(initial).method);
  const [value, setValue] = useState(() => parsePayoutDetails(initial).value);

  // From the prop alone: the action revalidates the layout, so `initial`
  // arrives filled in after a save and the notice goes with it. Saving an
  // empty field leaves it up next to "Saved", which is the truth.
  const missing = initial.trim() === "";

  return (
    <Section
      title="Payout details"
      className={className}
      actions={
        <div className="flex items-center gap-2.5">
          {state.saved && (
            <span className="flex items-center gap-1 text-xs font-medium text-status-success">
              <Check className="size-3.5" />
              Saved
            </span>
          )}
          <Button type="submit" form={formId} size="sm" className="cursor-pointer" disabled={pending}>
            {pending ? "Saving" : "Save"}
          </Button>
        </div>
      }
    >
      <form id={formId} action={formAction} className="flex flex-col gap-2.5">
        {/* The one consequence this screen has that nothing on it shows: an
            empty field means the merchant has nowhere to send the money. Said
            here, where it is fixed, and nowhere else. */}
        {missing && (
          <p className="shrink-0 rounded-(--radius) bg-status-warning-bg px-3 py-2 text-[13px] text-status-warning">
            Until this is filled in, your merchant has nowhere to send your money.
          </p>
        )}
        <input type="hidden" name="payoutDetails" value={composePayoutDetails(method, value)} />
        <div className="flex gap-2">
          <Select items={METHOD_LABELS} value={method} onValueChange={(next) => setMethod(next as PayoutMethod)}>
            <SelectTrigger className="h-9 w-40 shrink-0 cursor-pointer" aria-label="Payout method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(METHOD_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key} className="cursor-pointer">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={METHOD_LABELS[method]}
            placeholder={PAYOUT_METHODS[method].placeholder}
            spellCheck={false}
          />
        </div>
        {state.error && (
          <p role="alert" className="shrink-0 text-[13px] text-status-danger">
            {state.error}
          </p>
        )}
      </form>
    </Section>
  );
}
