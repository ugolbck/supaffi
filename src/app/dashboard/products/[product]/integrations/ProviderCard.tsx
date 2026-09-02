import Link from "next/link";
import { Check, Lock } from "lucide-react";
import type { Provider } from "./providers";
import { BrandMark } from "./BrandMark";

export function ProviderCard({
  provider,
  href,
  connected,
  index,
}: {
  provider: Provider;
  href: string;
  connected: boolean;
  index: number;
}) {
  const planned = provider.status === "planned";

  const inner = (
    <>
      {/* One soft wash of the provider's colour, anchored behind its icon in
          the top-left and sized well past the card so only its gentle part
          lands inside. Strengthens on hover. No hard edges: an earlier
          hairline along the top read as a stray border. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-75 transition-opacity duration-200 ease-[var(--ease-out)] group-hover/provider:opacity-100"
        style={{
          background: `radial-gradient(115% 120% at 6% 0%, ${provider.tint}4d 0%, ${provider.tint}1f 38%, transparent 74%)`,
        }}
      />

      <div className="relative flex items-center gap-3">
        <BrandMark provider={provider} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <h3 className="font-heading text-sm font-semibold tracking-tight">{provider.name}</h3>
            {connected && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-status-success-bg px-1.5 py-0.5 text-[11px] font-medium text-status-success">
                <Check className="size-3" strokeWidth={3} />
                Connected
              </span>
            )}
            {planned && <Lock className="size-3 shrink-0 text-muted-foreground/70" />}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {planned ? "Coming soon." : provider.blurb}
          </p>
        </div>
      </div>
    </>
  );

  const base =
    "group/provider animate-in fade-in slide-in-from-bottom-2 fill-mode-both relative flex flex-col overflow-hidden rounded-(--radius-xl) border border-border/70 bg-card [background-image:var(--card-surface)] p-3.5 duration-300 ease-[var(--ease-out)]";

  if (planned) {
    return (
      <div
        className={`${base} opacity-55`}
        style={{ animationDelay: `${index * 50}ms` }}
        aria-disabled
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={href}
      // Only transform and box-shadow transition, never `all`. Tailwind v4
      // already wraps `hover:` in `@media (hover: hover)`, so a tap on touch
      // will not leave the card stuck in its hover state.
      className={`${base} cursor-pointer shadow-[var(--edge-light),var(--shadow-sm)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--edge-light),var(--shadow-lg)] active:scale-[0.985]`}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {inner}
    </Link>
  );
}
