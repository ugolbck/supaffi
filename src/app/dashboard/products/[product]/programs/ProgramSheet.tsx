"use client";

import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TermsForm } from "@/components/TermsForm";
import type { ProgramFormValues } from "@/lib/programValidation";

/**
 * The terms form, in the panel the list opens. Same form onboarding uses, so a
 * program is written and read in one place and the explanations underneath the
 * fields do not exist twice.
 */

type Action = (prev: { error: string }, formData: FormData) => Promise<{ error: string }>;

export function ProgramSheet({
  title,
  action,
  initial,
  listHref,
}: {
  title: string;
  action: Action;
  initial?: ProgramFormValues;
  listHref: string;
}) {
  const router = useRouter();

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(listHref);
      }}
    >
      <SheetContent className="w-[420px] overflow-y-auto data-[side=right]:sm:max-w-[420px]">
        <SheetHeader className="pr-12">
          <SheetTitle className="truncate">{title}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          <TermsForm action={action} initial={initial} submitLabel={initial ? "Save" : "Create program"} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
