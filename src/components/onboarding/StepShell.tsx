import { cn } from "@/lib/utils";

/**
 * The frame every step renders into.
 *
 * Left aligned and capped narrow: a centred column reads as a marketing
 * page, and this is tooling. The header block sits bare on the canvas with
 * no container of its own — only the task below it is a surface.
 */
export function StepShell({
  step,
  title,
  lede,
  children,
  action,
}: {
  /** Position and total, both from the step model. Never written by hand. */
  step: { index: number; total: number };
  title: string;
  lede?: string;
  children: React.ReactNode;
  /** The primary way forward. Left aligned under the task, never floated. */
  action?: React.ReactNode;
}) {
  return (
    <section className="flex w-full max-w-[640px] flex-col">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase">
          Step {step.index} of {step.total}
        </p>
        <h1 className="text-[27px] leading-[1.2] font-semibold tracking-[-0.02em] text-balance">{title}</h1>
        {lede && <p className="max-w-[52ch] text-sm text-muted-foreground text-pretty">{lede}</p>}
      </header>
      <div className="mt-8 flex flex-col gap-4">{children}</div>
      {action && <div className="mt-6 flex items-center gap-3">{action}</div>}
    </section>
  );
}

/**
 * An instruction that sits on the canvas above a surface, never inside a
 * border. Deliberately identical to the lede: both are the same kind of
 * sentence, and setting one muted and the other bold made a single screen
 * look like it had two different voices.
 */
export function StepLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("max-w-[52ch] text-sm text-muted-foreground text-pretty", className)}>{children}</p>;
}
