"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Action = (prev: { error: string }, formData: FormData) => Promise<{ error: string }>;

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
    <form action={formAction} className="flex flex-col gap-3">
      <Label htmlFor="value">{label}</Label>
      <Input id="value" name="value" placeholder={placeholder} className="font-mono" autoComplete="off" required />
      {state.error && <p role="alert" className="text-sm text-status-danger">{state.error}</p>}
      <div>
        <Button type="submit" size="lg" className="cursor-pointer" disabled={pending}>
          {pending ? "Checking" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
