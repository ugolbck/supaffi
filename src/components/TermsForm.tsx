"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Field, FormCard } from "@/components/Field";
import { Term } from "@/components/Term";
import type { ProgramFormValues } from "@/lib/programValidation";

type Action = (prev: { error: string }, formData: FormData) => Promise<{ error: string }>;

export const TERMS_DEFAULTS: ProgramFormValues = {
  name: "Standard",
  defaultCommissionRate: "20",
  commissionDurationType: "FOREVER",
  commissionDurationMonths: "",
  attributionWindowDays: "60",
  holdingPeriodDays: "30",
};

// Passed to the Select as `items` so the trigger shows the sentence rather
// than the raw enum name it submits.
const DURATIONS: Record<string, string> = {
  FOREVER: "of every payment, forever",
  FIXED_MONTHS: "of every payment, for some months",
  ONE_TIME: "of the first payment only",
};

const NUMBER = "w-20 tabular-nums";

/**
 * Labels above their fields on one card, the layout every form shares. Only
 * the two windows carry a qualifier, because they are the only labels here
 * that do not explain themselves.
 */
export function TermsForm({
  action,
  initial = TERMS_DEFAULTS,
  signupOpen,
  submitLabel,
}: {
  action: Action;
  initial?: ProgramFormValues;
  /** Shown only where it is set: onboarding's first program is always open. */
  signupOpen?: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [duration, setDuration] = useState(initial.commissionDurationType);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <FormCard>
        <Field label="Program name" htmlFor="program-name">
          <Input id="program-name" name="name" defaultValue={initial.name} required />
        </Field>

        <Field label="Commission" htmlFor="program-rate">
          <div className="flex items-center gap-2">
            <div className="relative shrink-0">
              <Input
                id="program-rate"
                name="defaultCommissionRate"
                type="number"
                min="1"
                max="100"
                step="1"
                defaultValue={initial.defaultCommissionRate}
                required
                className="w-24 pr-7 tabular-nums"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                %
              </span>
            </div>
            <Select
              name="commissionDurationType"
              items={DURATIONS}
              value={duration}
              onValueChange={(value) => setDuration(String(value))}
            >
              <SelectTrigger className="h-9 min-w-0 flex-1 cursor-pointer" aria-label="How long commission is paid">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DURATIONS).map(([value, label]) => (
                  <SelectItem key={value} value={value} className="cursor-pointer">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Field>

        {duration === "FIXED_MONTHS" && (
          <Field label="Months of renewals" htmlFor="program-months">
            <Input
              id="program-months"
              name="commissionDurationMonths"
              type="number"
              min="1"
              step="1"
              defaultValue={initial.commissionDurationMonths || "12"}
              className={NUMBER}
            />
          </Field>
        )}

        {/* The same words the affiliate sees on their signup page, not the
            model's. What the number means sits behind the underline. */}
        <div className="grid grid-cols-2 gap-5">
          <Field
            label={<Term tip="A sale counts for the affiliate if it happens within this many days of their click.">Time to buy</Term>}
            htmlFor="program-window"
          >
            <div className="flex items-center gap-2">
              <Input
                id="program-window"
                name="attributionWindowDays"
                type="number"
                min="1"
                step="1"
                defaultValue={initial.attributionWindowDays}
                required
                className={NUMBER}
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </Field>

          <Field
            label={<Term tip="A commission waits this long before it is yours to pay, so a refund can still cancel it.">Hold before paying</Term>}
            htmlFor="program-hold"
          >
            <div className="flex items-center gap-2">
              <Input
                id="program-hold"
                name="holdingPeriodDays"
                type="number"
                min="1"
                step="1"
                defaultValue={initial.holdingPeriodDays}
                required
                className={NUMBER}
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </Field>
        </div>

        {signupOpen !== undefined && (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox name="signupOpen" defaultChecked={signupOpen} className="cursor-pointer" />
            <Term tip="Anyone with the signup link can join. Turn it off for a tier you move affiliates into yourself.">
              Public signup
            </Term>
          </label>
        )}
      </FormCard>

      {state.error && (
        <p role="alert" className="text-[13px] text-status-danger">
          {state.error}
        </p>
      )}
      <div>
        <Button type="submit" size="lg" className="cursor-pointer" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
