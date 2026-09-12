"use client";

import { Check, Copy } from "lucide-react";
import { useCopy } from "./useCopy";
import { cn } from "@/lib/utils";

export type RecordRow = {
  label: string;
  value: string | null;
  /** Renders as a badge rather than as a value. For the record type. */
  badge?: boolean;
  copyable?: boolean;
  /** Announced in place of the value when it is null. */
  missing?: string;
};

/**
 * The DNS record. Rows separated by hairlines, no vertical rules, values in
 * mono, copy revealed on row hover so four copy buttons do not shout at once.
 *
 * A value the server does not know yet renders as a skeleton rather than as a
 * sentence about it being unconfigured: the shape says something belongs
 * there without spending a line explaining our own plumbing.
 */
export function RecordTable({ records }: { records: RecordRow[] }) {
  return (
    <dl className="divide-y divide-neutral-200">
      {records.map((record) => (
        <Row key={record.label} record={record} />
      ))}
    </dl>
  );
}

function Row({ record }: { record: RecordRow }) {
  const [copied, copy] = useCopy();
  const canCopy = record.copyable !== false && record.value !== null;

  return (
    <div className="group flex h-11 items-center gap-4 px-4 transition-colors duration-100 ease-(--ease-out) hover:bg-neutral-50">
      <dt className="w-18 shrink-0 text-[13px] text-muted-foreground">{record.label}</dt>
      <dd className="flex min-w-0 flex-1 items-center gap-2">
        {record.value === null ? (
          <span
            className="h-3 w-40 animate-pulse rounded-full bg-neutral-200"
            aria-label={record.missing ?? "Not available yet"}
          />
        ) : record.badge ? (
          <span className="rounded-(--radius-sm) border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide text-neutral-700 uppercase">
            {record.value}
          </span>
        ) : (
          <span className="min-w-0 truncate font-mono text-[13px] text-neutral-800">{record.value}</span>
        )}
        {canCopy && (
          <button
            type="button"
            onClick={() => copy(record.value!)}
            aria-label={copied ? "Copied" : `Copy ${record.label}`}
            className={cn(
              "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-(--radius-sm) text-neutral-500",
              "opacity-0 transition-[opacity,color,background-color] duration-100 ease-(--ease-out)",
              "group-hover:opacity-100 hover:bg-neutral-200 hover:text-neutral-900 focus-visible:opacity-100"
            )}
          >
            {copied ? <Check className="size-3.5 text-status-success" /> : <Copy className="size-3.5" />}
          </button>
        )}
      </dd>
    </div>
  );
}
