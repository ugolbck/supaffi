import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/**
 * A label above its control: the one field layout every form uses, from
 * setup and login to onboarding and the program editor.
 */
export function Field({ label, htmlFor, children }: { label: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

/** The raised white surface a form's fields sit on. */
export function FormCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5 rounded-(--radius) border border-border bg-elevated p-5">
      {children}
    </div>
  );
}
