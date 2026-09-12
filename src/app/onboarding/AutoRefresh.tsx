"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-renders the server page on an interval while something is still
// waiting. Stops the moment it is not, so a finished step does not keep
// polling Stripe and Resend for the rest of the session.
export function AutoRefresh({
  active,
  everyMs = 5000,
  firstMs = 1200,
}: {
  active: boolean;
  everyMs?: number;
  /**
   * The first look, sooner than the rest. The screen is rendered from what
   * was already known while the real checks run behind it, so this is the
   * tick that collects them: without it the lights sit grey for a full
   * interval on a screen that has its answer ready after a second.
   */
  firstMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      router.refresh();
      interval = setInterval(() => router.refresh(), everyMs);
    }, firstMs);
    return () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    };
  }, [active, everyMs, firstMs, router]);
  return null;
}
