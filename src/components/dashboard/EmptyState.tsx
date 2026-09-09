import type { ReactNode } from "react";

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-6">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground text-pretty">{body}</p>
      {action}
    </div>
  );
}
