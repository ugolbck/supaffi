import type { CheckResult } from "@/lib/checks/dns";
import { cn } from "@/lib/utils";

// Green filled for passed, amber ring for waiting. Always followed by a few
// words, never a bare dot.
export function Light({ result, label }: { result: CheckResult; label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        aria-hidden
        className={cn(
          "size-2.5 shrink-0 rounded-full",
          result.ok ? "bg-status-success" : "border-2 border-status-warning"
        )}
      />
      <span className={cn(!result.ok && "text-muted-foreground")}>{label}</span>
      {!result.ok && result.detail && <span className="text-xs text-muted-foreground/70">{result.detail}</span>}
    </div>
  );
}
