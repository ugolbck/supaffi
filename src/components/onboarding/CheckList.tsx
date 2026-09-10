"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { CheckResult } from "@/lib/checks/dns";

export type CheckState = "pending" | "ok" | "failed";

/**
 * One place for the ternary every call site was repeating: ok is ok, and
 * otherwise `pendingWhen` decides whether the check's own detail describes
 * something that has simply not appeared yet (pending) or an answer that
 * arrived and is wrong (failed). Without this, a wrongly pointed record and
 * one that was never created read as the same pulsing grey line.
 */
export function checkState(result: CheckResult, pendingWhen: (detail: string) => boolean): CheckState {
  if (result.ok) return "ok";
  return pendingWhen(result.detail) ? "pending" : "failed";
}

/**
 * A check carries one line of copy per state, never one line written in the
 * passed tense and shown in all three.
 *
 * That was the bug worth naming: a grey, still-waiting row that read "Script
 * found on your site" told the user the opposite of the truth, and a red row
 * saying "nothing there yet" could not be told apart from one still working.
 * Waiting says it is waiting, passing says it worked, failing says what is
 * wrong.
 */
export type CheckRow = {
  id: string;
  state: CheckState;
  /** While we are still looking. */
  pending: string;
  /** Once it worked. Confirms, rather than merely naming the check. */
  passed: string;
  /** Only when it is definitely wrong, not merely not-yet. */
  failed?: string;
  /** What to do about a failure. Never rendered in any other state. */
  hint?: string;
  /** Sits at the row's right edge: the one thing you can do about this row. */
  action?: React.ReactNode;
};

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

export function CheckList({ rows }: { rows: CheckRow[] }) {
  const justPassed = useJustPassed(rows);

  return (
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
                row.state === "ok" && "font-medium text-neutral-900"
              )}
            >
              {row.state === "ok" ? row.passed : row.state === "failed" ? (row.failed ?? row.pending) : row.pending}
            </span>
            {row.state === "failed" && row.hint && <span className="text-[13px] text-status-danger">{row.hint}</span>}
          </div>
          {row.action && <div className="-my-1 shrink-0">{row.action}</div>}
        </li>
      ))}
    </ul>
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
