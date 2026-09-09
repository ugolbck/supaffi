"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-renders the server page on an interval while something is still
// waiting. Stops the moment it is not, so a finished step does not keep
// polling Stripe and Resend for the rest of the session.
export function AutoRefresh({ active, everyMs = 15000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}
