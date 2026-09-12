"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copy-to-clipboard with the "Copied" window every copy control in the flow
 * shares. The timeout is cleared on unmount so a control copied and then
 * navigated away from does not set state on a dead component.
 */
export function useCopy(timeoutMs = 1800): [boolean, (value: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback(
    (value: string) => {
      void navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), timeoutMs);
    },
    [timeoutMs]
  );

  return [copied, copy];
}
