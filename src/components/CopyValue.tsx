"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** A value shown as text with a copy button beside it. */
export function CopyValue({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      <span className="truncate" title={value}>
        {value}
      </span>
      <button
        type="button"
        aria-label="Copy"
        className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-neutral-100 hover:text-foreground active:scale-[0.96]"
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-3.5 text-status-success" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}
