import type { Provider } from "./providers";

// Stripe and Paddle ship a filled app icon; Polar and Resend ship a bare mark.
// Rendering the second kind on a white tile over a near-white card meant the
// eye compared 36px of solid colour against a thin 21px line drawing, which is
// why they read as different sizes despite identical containers.
//
// So a glyph gets a surface of its own, making the square the visual unit in
// both cases, and its ink is scaled to the same share of that square as the
// glyph inside Stripe's icon. The surface is one neutral for every glyph
// rather than a tint of the brand colour: mixing a fixed percentage of a
// near-black brand into white lands far darker than the same percentage of a
// bright one, so Resend's tile came out visibly heavier than Polar's.
const GLYPH_INK = 0.56;

export function BrandMark({ provider, size = 36 }: { provider: Provider; size?: number }) {
  const shared =
    "relative flex shrink-0 items-center justify-center overflow-hidden rounded-(--radius-md)";

  if (!provider.logo) {
    return (
      <span
        className={`${shared} bg-muted font-heading text-sm font-semibold text-muted-foreground ring-1 ring-border/70 ring-inset`}
        style={{ width: size, height: size }}
      >
        {provider.name.charAt(0)}
      </span>
    );
  }

  if (provider.logoKind === "tile") {
    return (
      <span
        className={`${shared} shadow-[var(--shadow-xs)] ring-1 ring-black/10 ring-inset`}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/logos/${provider.logo}`}
          alt={provider.name}
          className="object-contain"
          style={{ width: size, height: size }}
        />
      </span>
    );
  }

  // Dividing by the file's own ink fraction cancels the padding baked into it,
  // so every glyph lands at GLYPH_INK of the tile whatever its canvas.
  const drawn = (size * GLYPH_INK) / (provider.logoInk ?? 1);

  return (
    <span
      className={`${shared} shadow-[var(--shadow-xs)] ring-1 ring-black/[0.06] ring-inset`}
      style={{
        width: size,
        height: size,
        backgroundColor: "color-mix(in oklch, var(--neutral-200) 70%, white)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/logos/${provider.logo}`}
        alt={provider.name}
        className="max-w-none object-contain"
        style={{ width: drawn, height: drawn }}
      />
    </span>
  );
}
