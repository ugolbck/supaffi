"use client";

import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PasteField } from "@/components/PasteField";

/**
 * Replacing one credential, in the panel the URL opens.
 *
 * Same two halves as the onboarding step it stands in for: the button that
 * creates the thing in Stripe or Resend with the right permissions already
 * set, and the field that takes what comes back. The action checks it before
 * it is stored and lands back here, so a working key is the only way the
 * sheet closes.
 */

type Action = (prev: { error: string }, formData: FormData) => Promise<{ error: string }>;

export function ConnectionSheet({
  title,
  lede,
  createLabel,
  createUrl,
  fieldLabel,
  placeholder,
  action,
  settingsHref,
}: {
  title: string;
  lede: string;
  createLabel: string;
  createUrl: string;
  fieldLabel: string;
  placeholder: string;
  action: Action;
  settingsHref: string;
}) {
  const router = useRouter();

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(settingsHref);
      }}
    >
      <SheetContent className="w-[420px] overflow-y-auto data-[side=right]:sm:max-w-[420px]">
        <SheetHeader className="pr-12">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{lede}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-6">
          <Button
            variant="secondary"
            className="w-fit cursor-pointer"
            render={<a href={createUrl} target="_blank" rel="noreferrer" />}
          >
            {createLabel}
          </Button>
          <PasteField
            label={fieldLabel}
            placeholder={placeholder}
            action={action}
            submitLabel="Save"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
