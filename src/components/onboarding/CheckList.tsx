"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CheckRow, CheckState } from "./checkRows";

// The pure half of this component lives next door, so it can be imported by a
// server module and by a test without dragging React in. Re-exported here so
// a call site still has one import for the list and the rows it feeds it.
export { checkState, dnsCheckRows, dnsPending, emailDomainPending, emailKeyPending, trackingPending } from "./checkRows";
export type { CheckRow, CheckState } from "./checkRows";

/**
 * Which rows flipped to passing since the last render. Without it, every
 * already-passing row would animate on first paint, which turns a
 * notification into decoration.
 */
function useJustPassed(rows: CheckRow[]): Set<string> {
  const previous = useRef<Map<string, CheckState> | null>(null);
  const [flipped, setFlipped] = useState<Set<string>>(new Set());

  useEffect(() => {
    const now = new Map(rows.map((r) => [r.id, r.state]));
    if (previous.current === null) {
      previous.current = now;
      return;
    }
    const changed = new Set<string>();
    for (const row of rows) {
      if (row.state === "ok" && previous.current.get(row.id) === "pending") changed.add(row.id);
    }
    previous.current = now;
    if (changed.size > 0) setFlipped(changed);
  }, [rows]);

  return flipped;
}

/**
 * `onRecheck`, when given, is a server action bound to the product and the
 * current step, wired as a form action so it works without client JS. It
 * renders as one row under the list, only while something has not settled:
 * the page already polls every 15 seconds (`AutoRefresh`), and without this
 * the only obvious move was to reload, which is exactly the habit not to
 * teach.
 */
export function CheckList({ rows, onRecheck }: { rows: CheckRow[]; onRecheck?: (formData: FormData) => void | Promise<void> }) {
  const justPassed = useJustPassed(rows);
  // Pending or failed, either way the list is not done: the owner still has
  // a reason to reach for "check now" rather than reload, whether they are
  // waiting on DNS or fixing what a failed row told them was wrong.
  const unsettled = rows.some((row) => row.state !== "ok");

  return (
    <div>
      <ul className="divide-y divide-neutral-200">
        {rows.map((row, i) => (
          <li
            key={row.id}
            className={cn("flex items-start gap-3 px-4 py-3", justPassed.has(row.id) && "supaffi-flash")}
            // Staggered so several rows flipping at once read as a sequence
            // rather than as one simultaneous blink.
            style={justPassed.has(row.id) ? { animationDelay: `${i * 60}ms` } : undefined}
          >
            <Marker state={row.state} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className={cn(
                  "text-sm",
                  row.state === "pending" && "text-muted-foreground",
                  // A failure carries the same weight as a pass: the row that
                  // needs reading should not be the quietest one on the list.
                  row.state !== "pending" && "font-medium text-neutral-900"
                )}
              >
                {row.state === "ok" ? row.passed : row.state === "failed" ? (row.failed ?? row.pending) : row.pending}
              </span>
              {/* The hint is an instruction, not a second error: the red cross and the
                  failed line have already said something is wrong. */}
              {row.state === "failed" && row.hint && (
                <span className="text-[13px] text-muted-foreground">{row.hint}</span>
              )}
            </div>
            {row.action && <div className="-my-1 shrink-0">{row.action}</div>}
          </li>
        ))}
      </ul>
      {unsettled && onRecheck && (
        <form
          action={onRecheck}
          className="flex items-center justify-between gap-3 border-t border-neutral-200 px-4 py-2"
        >
          <span className="text-[13px] text-muted-foreground">Checking every 15 seconds</span>
          <Button type="submit" variant="ghost" size="sm">
            Check now
          </Button>
        </form>
      )}
    </div>
  );
}

function Marker({ state }: { state: CheckState }) {
  if (state === "ok") {
    return (
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-status-success">
        <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden>
          <path
            d="M4 8.5l2.5 2.5L12 5.5"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="supaffi-draw"
          />
        </svg>
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-status-danger">
        <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden>
          <path d="M5 5l6 6M11 5l-6 6" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
      <span className="supaffi-pulse size-2 rounded-full bg-neutral-400" />
    </span>
  );
}
