"use client";

import { useActionState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormState = { error: string };

type Props = {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  initial?: {
    name: string;
    defaultCommissionRate: string;
    commissionDurationType: string;
    commissionDurationMonths: string;
    attributionWindowDays: string;
    holdingPeriodDays: string;
  };
  submitLabel: string;
};

const defaults = {
  name: "",
  defaultCommissionRate: "",
  commissionDurationType: "FOREVER",
  commissionDurationMonths: "",
  attributionWindowDays: "60",
  holdingPeriodDays: "30",
};

const selectClassName =
  "h-9 w-full min-w-0 appearance-none rounded-lg border border-input bg-elevated px-3 py-1 text-base shadow-[inset_0_1px_2px_rgba(15,15,35,0.04)] outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

export function ProgramForm({ action, initial, submitLabel }: Props) {
  const [state, formAction] = useActionState(action, { error: "" });
  const values = initial ?? defaults;

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{submitLabel === "Create Program" ? "Create a Program" : "Edit Program"}</CardTitle>
        <CardDescription>
          Defines the commission rate and eligibility rules Affiliates in this Program earn under.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          {state.error && (
            <p role="alert" className="text-sm text-status-danger">
              {state.error}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" type="text" name="name" defaultValue={values.name} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="defaultCommissionRate">Default commission rate (%)</Label>
            <Input
              id="defaultCommissionRate"
              type="number"
              name="defaultCommissionRate"
              defaultValue={values.defaultCommissionRate}
              min="0.01"
              max="100"
              step="0.01"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="commissionDurationType">Commission duration</Label>
            <div className="relative">
              <select
                id="commissionDurationType"
                name="commissionDurationType"
                defaultValue={values.commissionDurationType}
                className={selectClassName}
              >
                <option value="ONE_TIME">One-time</option>
                <option value="FIXED_MONTHS">Fixed number of months</option>
                <option value="FOREVER">Forever</option>
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="commissionDurationMonths">
              Duration in months <span className="text-muted-foreground">(fixed-months only)</span>
            </Label>
            <Input
              id="commissionDurationMonths"
              type="number"
              name="commissionDurationMonths"
              defaultValue={values.commissionDurationMonths}
              min="1"
              step="1"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="attributionWindowDays">Attribution window (days)</Label>
            <Input
              id="attributionWindowDays"
              type="number"
              name="attributionWindowDays"
              defaultValue={values.attributionWindowDays}
              min="1"
              step="1"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="holdingPeriodDays">Holding period (days)</Label>
            <Input
              id="holdingPeriodDays"
              type="number"
              name="holdingPeriodDays"
              defaultValue={values.holdingPeriodDays}
              min="1"
              step="1"
              required
            />
          </div>
          <Button type="submit" className="mt-1">
            {submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
