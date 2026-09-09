"use client";

import { CopyLinkButton } from "@/components/CopyLinkButton";

export function Copyable({ value, label = "Copy" }: { value: string; label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/40 py-1.5 pr-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
      <CopyLinkButton link={value} size="sm" label={label} />
    </div>
  );
}
