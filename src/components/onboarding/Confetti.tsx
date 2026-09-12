/**
 * Fires once, when a product's onboarding is finished.
 *
 * Deliberately server-renderable: every particle's numbers come from a pure
 * integer hash of its index, not from Math.random, so the markup the server
 * sends and the markup the client builds are identical. Randomising at render
 * time is how this kind of component ends up throwing a hydration error on
 * the one screen that is supposed to feel like a reward.
 */

const COUNT = 44;

// Green leads, because this is the app's first win. The rest are there so it
// reads as confetti rather than as a progress bar exploding.
const COLORS = ["var(--status-success)", "#4ade80", "var(--accent-400)", "var(--accent-600)", "#fbbf24"];

/** Bit-mixed integer hash. Identical on every engine, unlike Math.sin tricks. */
function noise(index: number, salt: number): number {
  let x = (index + 1) * 374761393 + salt * 668265263;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export function Confetti() {
  return (
    // Covers the viewport. The previous version clipped itself out of
    // existence: it was a zero-height box with overflow hidden, so every
    // particle was cropped away on the frame it was created.
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      {Array.from({ length: COUNT }, (_, i) => {
        const left = noise(i, 1) * 100;
        const drift = (noise(i, 2) - 0.5) * 320;
        const fall = 620 + noise(i, 3) * 480;
        const spin = (noise(i, 4) - 0.5) * 1080;
        const size = 6 + noise(i, 5) * 6;
        const duration = 2100 + noise(i, 6) * 1600;
        const delay = noise(i, 7) * 500;
        const round = noise(i, 8) > 0.65;
        return (
          <span
            key={i}
            className="supaffi-confetti absolute block"
            style={{
              left: `${left}%`,
              top: "-24px",
              width: size,
              height: size * (round ? 1 : 1.6),
              borderRadius: round ? "9999px" : "1px",
              background: COLORS[i % COLORS.length],
              ["--confetti-dx" as string]: `${drift}px`,
              ["--confetti-dy" as string]: `${fall}px`,
              ["--confetti-spin" as string]: `${spin}deg`,
              ["--confetti-duration" as string]: `${duration}ms`,
              ["--confetti-delay" as string]: `${delay}ms`,
            }}
          />
        );
      })}
    </div>
  );
}
