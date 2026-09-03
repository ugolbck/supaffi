"use client";

import { useActionState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type FormState = { error: string };

type Props = {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  initial?: { name: string; domain: string; websiteUrl: string };
  submitLabel: string;
};

// Extra precision for people who want it, on an icon rather than on the label
// itself: a dashed underline under a label sits one line above its input and
// crowds it. The one-line hint under the input still says what the field is,
// so nothing load-bearing is hidden behind the hover.
function More({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label="More information"
            className="inline-flex cursor-help text-muted-foreground/70 transition-colors duration-150 ease-[var(--ease-out)] hover:text-foreground"
          />
        }
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72 leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

function Field({
  id,
  label,
  hint,
  more,
  index,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  more?: React.ReactNode;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex animate-in flex-col gap-2 fill-mode-both fade-in slide-in-from-bottom-2 duration-300 ease-[var(--ease-out)]"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* The icon sits beside the <label>, not inside it: nested in the label
          it gets folded into the input's accessible name, which then reads
          "Tracking domain More information". */}
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        {more && <More>{more}</More>}
      </div>
      {children}
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

// Three fields, no credentials. Connecting Stripe and email delivery are
// their own onboarding step, so nobody is asked for a payment secret before
// anything has explained why Supaffi wants one.
export function MerchantForm({ action, initial, submitLabel }: Props) {
  const [state, formAction] = useActionState(action, { error: "" });

  return (
    <Card>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          {state.error && (
            <p role="alert" className="text-sm text-status-danger">
              {state.error}
            </p>
          )}

          <div className="grid grid-cols-1 gap-x-12 gap-y-5 md:grid-cols-2">
            <Field id="name" label="Name" index={0} hint="Affiliates see this.">
              <Input id="name" type="text" name="name" defaultValue={initial?.name} required />
            </Field>

            <Field
              id="websiteUrl"
              label="Website URL"
              index={1}
              hint="Where referral links send people."
            >
              <Input
                id="websiteUrl"
                type="text"
                name="websiteUrl"
                defaultValue={initial?.websiteUrl}
                placeholder="https://example.com"
                required
              />
            </Field>

            <Field
              id="domain"
              label="Tracking domain"
              index={2}
              hint="A subdomain you point at this server in your DNS."
              more={
                <>
                  Kept separate from your website so signups, referral redirects and payment
                  webhooks never touch your product&apos;s own DNS or traffic.
                </>
              }
            >
              <Input
                id="domain"
                type="text"
                name="domain"
                defaultValue={initial?.domain}
                placeholder="affiliates.example.com"
                required
              />
            </Field>
          </div>

          <div className="flex items-center gap-4 border-t border-border/60 pt-5">
            <Button type="submit" size="lg">
              {submitLabel}
            </Button>
            <p className="text-xs text-muted-foreground">Changeable later.</p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
