import { cn } from "@/lib/utils";

/**
 * The one bordered surface on a step.
 *
 * The rule this enforces: a screen gets a single raised object, and
 * everything else — eyebrow, title, supporting line, section labels — sits
 * bare on the page. A border per section is what turns a setup screen into a
 * stack of identical grey rectangles.
 *
 * Inside, sections are banded rather than uniform. A card whose every row is
 * white on white reads as one undifferentiated block of text, however
 * correct its structure is: the bands are what let someone see at a glance
 * which row introduces the rows under it and which row is data.
 */
export function TaskCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "divide-y divide-neutral-200 overflow-hidden rounded-(--radius-md) border border-neutral-300 bg-white shadow-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * The band that introduces the rows beneath it, carrying its own action.
 * "Add this record at Cloudflare" and the button that opens Cloudflare are
 * one object; split apart, the button was orphaned below the thing it acted
 * on and read as unrelated.
 */
export function TaskCardHeader({
  title,
  hint,
  action,
}: {
  /** A string, or a `Term` when the word needs a tooltip. */
  title: React.ReactNode;
  /** A short qualifier, never a sentence. */
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 bg-neutral-100 px-4 py-1.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-[13px] font-semibold text-neutral-700">{title}</span>
        {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function TaskCardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("p-4", className)}>{children}</div>;
}

/**
 * Flush section, for a table or list that supplies its own row padding.
 * `sunken` sets it back from the data above it, which is how the checks read
 * as a footer rather than as four more rows of the record.
 */
export function TaskCardSection({
  className,
  sunken = false,
  children,
}: {
  className?: string;
  sunken?: boolean;
  children: React.ReactNode;
}) {
  return <div className={cn(sunken && "bg-neutral-50", className)}>{children}</div>;
}
