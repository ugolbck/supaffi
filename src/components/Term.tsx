"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A word that needs one more sentence, without that sentence on the page.
 *
 * The rule across both sides of the app: copy says what a thing means to the
 * reader, never what it is called in the model, and never explains itself in
 * a second line. When a term really cannot be renamed away, it gets a dashed
 * underline and an instant tooltip, so the page stays quiet and the reader
 * who wants the detail gets it on hover.
 */
export function Term({ tip, className, children }: { tip: string; className?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "cursor-help underline decoration-neutral-400 decoration-dashed underline-offset-[3px] transition-colors hover:decoration-neutral-700",
              className
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
