"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TaskCard, TaskCardHeader, TaskCardSection } from "@/components/onboarding/TaskCard";
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
  FIXED_MONTHS: "of every payment, for a number of months",
  ONE_TIME: "of the first payment only",
};

const ROW = "h-14 w-full min-w-0 bg-transparent px-4 text-[15px] outline-none placeholder:text-neutral-400";
const NUMBER =
  "h-10 w-20 rounded-(--radius) border border-neutral-300 bg-white px-3 text-[15px] tabular-nums shadow-xs outline-none transition-colors duration-100 ease-(--ease-out) focus:border-accent-400";

/**
 * Built on the same banded card as the product step, so the two forms in the
 * flow are visibly the same kind of object. Each field gets a band naming it
 * and a row holding it, and only the two windows carry a qualifier, because
 * they are the only labels here that do not explain themselves.
 */
export function TermsForm({
  action,
  initial = TERMS_DEFAULTS,
  submitLabel,
}: {
  action: Action;
  initial?: ProgramFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [duration, setDuration] = useState(initial.commissionDurationType);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <TaskCard>
        <TaskCardHeader title="Program name" />
        <TaskCardSection>
          <input name="name" defaultValue={initial.name} required className={ROW} aria-label="Program name" />
        </TaskCardSection>

        <TaskCardHeader title="Commission" />
        <TaskCardSection className="flex items-center gap-3 p-4">
          <div className="relative shrink-0">
            <input
              name="defaultCommissionRate"
              type="number"
              min="1"
              max="100"
              step="1"
              defaultValue={initial.defaultCommissionRate}
              required
              aria-label="Commission rate"
              className={`${NUMBER} w-24 pr-7`}
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
            <SelectTrigger className="h-10 flex-1 cursor-pointer" aria-label="How long commission is paid">
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
        </TaskCardSection>

        {duration === "FIXED_MONTHS" && (
          <TaskCardSection className="flex items-center gap-2 p-4">
            <input
              name="commissionDurationMonths"
              type="number"
              min="1"
              step="1"
              defaultValue={initial.commissionDurationMonths || "12"}
              aria-label="Months of renewals"
              className={NUMBER}
            />
            <span className="text-sm text-muted-foreground">months of renewals</span>
          </TaskCardSection>
        )}

        {/* The same words the affiliate sees on their signup page, not the
            model's. What the number means sits behind the underline. */}
        <TaskCardHeader
          title={<Term tip="A sale counts for the affiliate if it happens within this many days of their click.">Time to buy</Term>}
        />
        <TaskCardSection className="flex items-center gap-2 p-4">
          <input
            name="attributionWindowDays"
            type="number"
            min="1"
            step="1"
            defaultValue={initial.attributionWindowDays}
            required
            aria-label="Time to buy, in days"
            className={NUMBER}
          />
          <span className="text-sm text-muted-foreground">days</span>
        </TaskCardSection>

        <TaskCardHeader
          title={<Term tip="A commission waits this long before it is yours to pay, so a refund can still cancel it.">Hold before paying</Term>}
        />
        <TaskCardSection className="flex items-center gap-2 p-4">
          <input
            name="holdingPeriodDays"
            type="number"
            min="1"
            step="1"
            defaultValue={initial.holdingPeriodDays}
            required
            aria-label="Hold before paying, in days"
            className={NUMBER}
          />
          <span className="text-sm text-muted-foreground">days</span>
        </TaskCardSection>
      </TaskCard>

      {state.error && (
        <p role="alert" className="text-[13px] text-status-danger">
          {state.error}
        </p>
      )}
      <div>
        <Button type="submit" size="lg" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
