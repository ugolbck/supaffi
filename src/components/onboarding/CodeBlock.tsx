"use client";

import { Check, Copy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCopy } from "./useCopy";
import { cn } from "@/lib/utils";

/**
 * Every piece of code in the flow renders through this. The header carries
 * the title and both copy actions, so there is never a second card asking
 * whether the reader is the person who touches the code.
 *
 * Both actions are labelled. An icon sitting flush against a labelled button
 * reads as part of that button, which made the raw-copy icon look like a
 * second way to copy the prompt. Words are what separate them.
 */
export function CodeBlock({
  title,
  code,
  prompt,
}: {
  title: string;
  code: string;
  /** The same snippet wrapped in instructions an assistant can act on. */
  prompt?: string;
}) {
  const [copiedCode, copyCode] = useCopy();
  const [copiedPrompt, copyPrompt] = useCopy();

  return (
    <div className="overflow-hidden rounded-(--radius-md) border border-neutral-300 bg-white shadow-sm">
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-100 py-1.5 pr-2 pl-4">
        <span className="truncate text-[13px] font-semibold text-neutral-700">{title}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {prompt && (
            <Button variant="secondary" size="sm" onClick={() => copyPrompt(prompt)}>
              {copiedPrompt ? <Check className="text-status-success" /> : <Sparkles />}
              Copy AI prompt
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => copyCode(code)}>
            {copiedCode ? <Check className="text-status-success" /> : <Copy />}
            Copy code
          </Button>
        </div>
      </div>
      {/* Scrolls rather than wraps. A wrapped line looks like two lines of
          code, which is exactly the confusion a snippet cannot afford. */}
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-relaxed text-neutral-800">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** A one-line value to copy: an endpoint, a link, a record value. */
export function CopyField({ value, mono = true, className }: { value: string; mono?: boolean; className?: string }) {
  const [copied, copy] = useCopy();
  return (
    <div
      className={cn(
        "flex h-12 items-center gap-2 rounded-(--radius-md) border border-neutral-300 bg-white pr-2 pl-4 shadow-xs",
        className
      )}
    >
      <span className={cn("min-w-0 flex-1 truncate text-sm", mono && "font-mono")}>{value}</span>
      <Button variant="secondary" size="sm" className="shrink-0" onClick={() => copy(value)}>
        {copied ? <Check className="text-status-success" /> : <Copy />}
        Copy
      </Button>
    </div>
  );
}
