import type { ReactNode } from "react";

/**
 * A list with nothing in it yet. Centred in whatever card it sits in, so an
 * empty affiliates screen is a composed screen rather than a sentence stuck
 * to the top-left of a big white box.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      {icon && (
        <span className="flex size-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 [&_svg]:size-5">
          {icon}
        </span>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-semibold tracking-tight">{title}</p>
        <p className="max-w-[36ch] text-sm text-muted-foreground text-pretty">{body}</p>
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
