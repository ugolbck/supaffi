"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Action = (prev: { error: string }, formData: FormData) => Promise<{ error: string }>;

/** A secret to paste, its label, and the one button that stores it. */
export function PasteField({
  label,
  placeholder,
  action,
  submitLabel = "Continue",
}: {
  label: string;
  placeholder: string;
  action: Action;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label htmlFor="value" className="text-sm text-muted-foreground">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id="value"
          name="value"
          placeholder={placeholder}
          autoComplete="off"
          required
          className="h-12 min-w-0 flex-1 rounded-(--radius-md) border border-neutral-300 bg-white px-4 font-mono text-[15px] shadow-xs outline-none transition-colors duration-100 ease-(--ease-out) placeholder:text-neutral-400 focus:border-accent-400"
        />
        <Button type="submit" size="lg" className="h-12" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {pending ? "Checking" : submitLabel}
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-[13px] text-status-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
