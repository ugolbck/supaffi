export function StepFrame({
  index,
  total,
  title,
  lede,
  children,
}: {
  index: number;
  total: number;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex w-full max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold tracking-wider text-accent-700 uppercase">
          Step {index} of {total}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {lede && <p className="text-sm text-muted-foreground text-pretty">{lede}</p>}
      </div>
      {children}
    </section>
  );
}
