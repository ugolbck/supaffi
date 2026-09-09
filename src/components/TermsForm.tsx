"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

function Explain({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground text-pretty">{children}</p>;
}

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
      {state.error && (
        <p role="alert" className="text-sm text-status-danger">
          {state.error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Program name</Label>
        <Input id="name" name="name" defaultValue={initial.name} required />
        <Explain>You can add more later, for example a VIP tier with a higher rate.</Explain>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="defaultCommissionRate">Commission</Label>
        <div className="flex gap-2">
          <div className="relative w-28">
            <Input
              id="defaultCommissionRate"
              name="defaultCommissionRate"
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              defaultValue={initial.defaultCommissionRate}
              required
              className="pr-7"
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
            <SelectTrigger className="flex-1 cursor-pointer" aria-label="How long commission is paid">
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
        {duration === "FOREVER" && <Explain>Forever means every renewal, for as long as the customer stays.</Explain>}
        {duration === "ONE_TIME" && <Explain>One payment, then nothing more for that customer.</Explain>}
        {duration === "FIXED_MONTHS" && (
          <div className="flex items-center gap-2">
            <Input
              name="commissionDurationMonths"
              type="number"
              min="1"
              step="1"
              defaultValue={initial.commissionDurationMonths || "12"}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">months of renewals</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="attributionWindowDays">Attribution window</Label>
        <div className="flex items-center gap-2">
          <Input
            id="attributionWindowDays"
            name="attributionWindowDays"
            type="number"
            min="1"
            step="1"
            defaultValue={initial.attributionWindowDays}
            className="w-24"
            required
          />
          <span className="text-sm text-muted-foreground">days</span>
        </div>
        <Explain>How long after clicking a link a purchase still counts for the affiliate.</Explain>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="holdingPeriodDays">Holding period</Label>
        <div className="flex items-center gap-2">
          <Input
            id="holdingPeriodDays"
            name="holdingPeriodDays"
            type="number"
            min="1"
            step="1"
            defaultValue={initial.holdingPeriodDays}
            className="w-24"
            required
          />
          <span className="text-sm text-muted-foreground">days</span>
        </div>
        <Explain>How long a commission waits before you pay it, so refunds come out first.</Explain>
      </div>

      <div>
        <Button type="submit" size="lg" className="cursor-pointer" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
