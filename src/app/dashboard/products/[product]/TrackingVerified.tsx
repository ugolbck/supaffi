"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { markTrackingSeen } from "./markTrackingSeen";

/**
 * Shown once, on the visit after the first sale arrived carrying a referral
 * token. The event happens while the Owner is away, so it has to wait for them
 * rather than fire live.
 *
 * Not a modal and not confetti. It reports something true and gets out of the
 * way: the Owner may well be here to do something else entirely.
 */
export function TrackingVerified({ merchantId }: { merchantId: string }) {
  const [dismissed, setDismissed] = useState(false);
  // Ref guard because React runs effects twice in development, and the second
  // run would spend a moment that has already been spent.
  const marked = useRef(false);

  useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    // Fire and forget. Failing to record that it was seen is worth far less
    // than blocking the dashboard on it, and the worst case is showing this
    // one more time.
    void markTrackingSeen(merchantId);
  }, [merchantId]);

  if (dismissed) return null;

  return (
    <div
      role="status"
      className="flex animate-in items-start gap-3 rounded-(--radius-xl) border border-status-success/25 bg-status-success-bg fade-in slide-in-from-top-2 p-4 shadow-[var(--edge-light),var(--shadow-sm)] duration-300 ease-[var(--ease-out)]"
    >
      <span className="flex size-7 shrink-0 animate-in items-center justify-center rounded-full bg-status-success text-white zoom-in-50 delay-150 duration-300 ease-[var(--ease-out)] fill-mode-both">
        <Check className="size-4" strokeWidth={3} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-heading text-sm font-semibold tracking-tight text-status-success">
          Tracking is working
        </p>
        <p className="text-sm text-muted-foreground">
          A sale came through carrying a referral token. Commissions are being recorded.
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors duration-150 ease-[var(--ease-out)] hover:bg-black/5 hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
