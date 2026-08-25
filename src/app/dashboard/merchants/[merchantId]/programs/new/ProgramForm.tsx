"use client";

import { useActionState } from "react";

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

export function ProgramForm({ action, initial, submitLabel }: Props) {
  const [state, formAction] = useActionState(action, { error: "" });
  const values = initial ?? defaults;

  return (
    <form action={formAction}>
      {state.error && <p role="alert">{state.error}</p>}
      <label>
        Name
        <input type="text" name="name" defaultValue={values.name} required />
      </label>
      <label>
        Default commission rate (%)
        <input
          type="number"
          name="defaultCommissionRate"
          defaultValue={values.defaultCommissionRate}
          min="0.01"
          max="100"
          step="0.01"
          required
        />
      </label>
      <label>
        Commission duration
        <select name="commissionDurationType" defaultValue={values.commissionDurationType}>
          <option value="ONE_TIME">One-time</option>
          <option value="FIXED_MONTHS">Fixed number of months</option>
          <option value="FOREVER">Forever</option>
        </select>
      </label>
      <label>
        Duration in months (only used for &quot;Fixed number of months&quot;)
        <input
          type="number"
          name="commissionDurationMonths"
          defaultValue={values.commissionDurationMonths}
          min="1"
          step="1"
        />
      </label>
      <label>
        Attribution window (days)
        <input
          type="number"
          name="attributionWindowDays"
          defaultValue={values.attributionWindowDays}
          min="1"
          step="1"
          required
        />
      </label>
      <label>
        Holding period (days)
        <input
          type="number"
          name="holdingPeriodDays"
          defaultValue={values.holdingPeriodDays}
          min="1"
          step="1"
          required
        />
      </label>
      <button type="submit" className="cursor-pointer">
        {submitLabel}
      </button>
    </form>
  );
}
