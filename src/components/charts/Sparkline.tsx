/**
 * A trend line small enough to live inside a stat tile.
 *
 * Plain SVG, no charting dependency, and no client boundary: it renders on the
 * server with the number it belongs to.
 *
 * `preserveAspectRatio="none"` lets the path stretch to whatever box it is
 * given; `vector-effect` keeps the stroke from stretching with it. A flat
 * series draws a centred straight line rather than dividing by zero.
 */
export function Sparkline({ points, className = "" }: { points: number[]; className?: string }) {
  if (points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const flat = max === min;

  const coords = points.map((value, i) => {
    const x = (i / (points.length - 1)) * 100;
    const y = flat ? 16 : 30 - ((value - min) / span) * 28;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
    >
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
