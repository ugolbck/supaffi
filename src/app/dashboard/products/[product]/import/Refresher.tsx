"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Reloads the page's data every few seconds while the worker is busy. */
export function Refresher() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 3_000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
