import { useId } from "react";

/**
 * A trend line that fills whatever box it is given.
 *
 * Plain SVG, no charting dependency, and no client boundary: it renders on the
 * server alongside the number it belongs to.
 *
 * `preserveAspectRatio="none"` lets the path stretch to the box;
 * `vector-effect` keeps the stroke from stretching with it. A flat series draws
 * a centred straight line rather than dividing by zero.
 *
 * `area` fills underneath with the same fade the main chart uses, so a tile's
 * line and the chart's line read as the same drawing at two sizes.
 */
export function Sparkline({
  points,
  className = "",
  area = false,
}: {
  points: number[];
  className?: string;
  area?: boolean;
}) {
  const id = useId();
  if (points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const flat = max === min;

  const coords = points.map((value, i) => {
    const x = (i / (points.length - 1)) * 100;
    const y = flat ? 16 : 30 - ((value - min) / span) * 28;
    return { x, y };
  });
  const line = coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");

  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
    >
      {area && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`0,32 ${line} 100,32`} fill={`url(#${id})`} />
        </>
      )}
      <polyline
        points={line}
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
