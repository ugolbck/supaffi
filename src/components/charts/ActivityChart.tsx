"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Amounts, Bucket, DayPoint } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * Clicks as a line over bars of the money they turned into, for one window.
 *
 * The bars are money, not a count of sales. A count answers "how busy was
 * it", and the person reading this already knows that from the line above
 * it. What they are here for, and what they show other people, is what the
 * programme is worth: revenue for the Owner, earnings for the Affiliate. The
 * count still has its place, in the tooltip, beside the amount it produced.
 *
 * Hand-drawn SVG, measured in pixels. A viewBox that stretches would stretch
 * the stroke and the corner radii with it, and the tooltip has to know
 * where a bar really is on screen. So the box is measured, the geometry is
 * computed from that, and the SVG is redrawn on resize.
 *
 * Two scales, one per series. Clicks and sales are never on the same order
 * of magnitude: sharing an axis would flatten the bars to a hairline under
 * the line and hide the one thing the Owner is here to see.
 *
 * The line is drawn as a monotone cubic, so it never overshoots a point:
 * a curve that dips below zero between two quiet days is drawing traffic
 * that did not happen.
 *
 * Hover is a column, not a point. Anywhere in a bucket's width lights that
 * bucket, glows its bar, and opens the tooltip at once. There is no delay
 * to wait through and no animation to sit out: the reader is scanning, and
 * a tooltip that fades is a tooltip that lags.
 */

const PAD = { top: 12, right: 40, bottom: 26, left: 36 };
const BAR_MAX = 34;
/**
 * How much of the plot the tallest value is allowed. A peak touching the
 * ceiling reads as clipped, and a lone sale against a scale whose maximum is
 * one drew a bar the full height of the card for a quiet day.
 */
const HEADROOM = { line: 0.9, bar: 0.72 };

/** Short money for an axis: 1.2k, 14k, 1.1m. Never printed as an amount. */
function compactMoney(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(Math.round(value));
}

const HOUR = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
const MONTH_LONG = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function stamp(point: DayPoint): Date {
  return new Date(point.date.length === 10 ? `${point.date}T00:00:00Z` : point.date);
}

/** The label under the axis: short, and the one form that fits the bucket. */
function axisLabel(point: DayPoint, bucket: Bucket): string {
  const at = stamp(point);
  if (bucket === "hour") return HOUR.format(at);
  if (bucket === "day") return DAY.format(at);
  return MONTH.format(at);
}

/** The tooltip's heading: the whole period, in words. */
function periodLabel(point: DayPoint, bucket: Bucket): string {
  const at = stamp(point);
  if (bucket === "hour") {
    const end = new Date(at.getTime() + 3_600_000);
    return `${DAY.format(at)}, ${HOUR.format(at)} to ${HOUR.format(end)}`;
  }
  if (bucket === "day") return DAY_LONG.format(at);
  return MONTH_LONG.format(at);
}

/**
 * A round number at or above the value, for an axis. Finer than the usual
 * 1-2-5 ladder: with three steps to a decade, a peak of ten lands on a scale
 * of fifteen rather than twenty, and the bars keep two thirds of the height
 * instead of half.
 */
const STEPS = [1, 1.5, 2, 3, 4, 5, 6, 8, 10];

function niceMax(value: number, minimum = 1): number {
  const target = Math.max(value, minimum);
  if (target <= 0) return minimum;
  const power = 10 ** Math.floor(Math.log10(target));
  for (const step of STEPS) {
    const candidate = step * power;
    if (candidate >= target) return candidate;
  }
  return 10 * power;
}

function monotonePath(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n === 0) return "";
  if (n === 1) return `M${xs[0]},${ys[0]}`;
  const slopes: number[] = [];
  const deltas: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = xs[i + 1] - xs[i];
    deltas.push(dx === 0 ? 0 : (ys[i + 1] - ys[i]) / dx);
  }
  slopes.push(deltas[0]);
  for (let i = 1; i < n - 1; i += 1) {
    const a = deltas[i - 1];
    const b = deltas[i];
    slopes.push(a * b <= 0 ? 0 : (a + b) / 2);
  }
  slopes.push(deltas[n - 2]);
  // Fritsch and Carlson: pull tangents in where they would overshoot.
  for (let i = 0; i < n - 1; i += 1) {
    if (deltas[i] === 0) {
      slopes[i] = 0;
      slopes[i + 1] = 0;
      continue;
    }
    const a = slopes[i] / deltas[i];
    const b = slopes[i + 1] / deltas[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      slopes[i] = (3 * a) / h * deltas[i];
      slopes[i + 1] = (3 * b) / h * deltas[i];
    }
  }
  let d = `M${xs[0]},${ys[0]}`;
  for (let i = 0; i < n - 1; i += 1) {
    const dx = (xs[i + 1] - xs[i]) / 3;
    d += ` C${xs[i] + dx},${ys[i] + slopes[i] * dx} ${xs[i + 1] - dx},${ys[i + 1] - slopes[i + 1] * dx} ${xs[i + 1]},${ys[i + 1]}`;
  }
  return d;
}

/**
 * A bar with a rounded top and a square foot. `rx` on a rect rounds all four
 * corners, which lifts the bar off the axis it is standing on and turns a
 * short one into a lozenge floating above zero.
 */
function barPath(x: number, y: number, w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, w / 2, h));
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

function money(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
}

/**
 * Every currency in the bucket, the drawn one first.
 *
 * Money is never added across currencies, here or anywhere: 99 EUR and 50
 * USD is not 149 of anything. So the bar is the one currency the axis names
 * and the tooltip lists them all, one line under another, which is how a
 * figure in two currencies is written everywhere else in the product.
 */
function byCurrency(
  amounts: Record<string, Amounts>,
  drawn: string | null,
  field: "gross" | "commission"
): string[] {
  return Object.entries(amounts)
    .filter(([, value]) => value[field] > 0)
    .sort(([a], [b]) => (a === drawn ? -1 : b === drawn ? 1 : a.localeCompare(b)))
    .map(([currency, value]) => money(value[field], currency));
}

export function ActivityChart({
  points,
  bucket,
  currency,
  barLabel,
  countLabel,
  splitLabel,
  className,
}: {
  points: DayPoint[];
  bucket: Bucket;
  /** The one currency the bars are drawn in. Null draws no bars at all. */
  currency: string | null;
  /** What the money is: "Revenue" for the Owner, "Earned" for the Affiliate. */
  barLabel: string;
  /** What the count beside it is: "Sales" for the Owner, "Commissions" for the Affiliate. */
  countLabel: string;
  /**
   * Names the slice drawn above the solid part: the Owner's cost. Given, the
   * bar is the whole sale with the commission ghosted on top of what he
   * keeps. Omitted, the bar is solid, which is the Affiliate's own earnings
   * with nothing to take out of them.
   */
  splitLabel?: string;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hovered, setHovered] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Bars grow and the line fades in once, on the first frame after the
  // geometry exists. Re-armed whenever the window changes, since a new
  // series is a new chart.
  const signature = `${bucket}:${points[0]?.date}:${points.length}`;
  useEffect(() => {
    setDrawn(false);
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, [signature]);

  const { width, height } = size;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = Math.max(0, height - PAD.top - PAD.bottom);
  const n = points.length;
  const slot = n > 0 ? plotW / n : 0;
  const barW = Math.min(BAR_MAX, Math.max(5, slot * 0.7));

  // Divided by the headroom rather than multiplied into the geometry, so the
  // number printed on the axis is still the top of the axis.
  const grossAt = (p: DayPoint) => (currency ? (p.amounts[currency]?.gross ?? 0) : 0);
  const commissionAt = (p: DayPoint) => (currency ? (p.amounts[currency]?.commission ?? 0) : 0);
  const clickMax = niceMax(Math.max(0, ...points.map((p) => p.clicks)) / HEADROOM.line, 4);
  const barMax = niceMax(Math.max(0, ...points.map(grossAt)) / HEADROOM.bar, 10);
  const xAt = (i: number) => PAD.left + slot * (i + 0.5);
  const yClicks = (v: number) => PAD.top + plotH - (v / clickMax) * plotH;
  const yBars = (v: number) => PAD.top + plotH - (v / barMax) * plotH;
  const baseline = PAD.top + plotH;

  const xs = points.map((_, i) => xAt(i));
  const ys = points.map((p) => yClicks(p.clicks));
  const linePath = monotonePath(xs, ys);
  const areaPath = n > 0 ? `${linePath} L${xs[n - 1]},${baseline} L${xs[0]},${baseline} Z` : "";

  // Every nth bucket, counted from the first. Dividing the range into five
  // instead put the labels at uneven gaps, and rounding landed two of them
  // on neighbouring buckets. Six is the most a card this wide can hold.
  const step = n > 0 ? Math.max(1, Math.ceil(n / 6)) : 1;
  const labelled = new Set<number>();
  for (let i = 0; i < n; i += step) labelled.add(i);
  const ticks = [0, 0.5, 1];

  const active = hovered === null ? null : points[hovered];
  const grossLines = active ? byCurrency(active.amounts, currency, "gross") : [];
  const costLines = active && splitLabel ? byCurrency(active.amounts, currency, "commission") : [];
  const tooltipX = hovered === null ? 0 : Math.min(Math.max(xAt(hovered), 120), Math.max(120, width - 120));

  return (
    <div ref={box} data-slot="activity-chart" className={cn("relative min-h-0 flex-1 select-none", className)}>
      {width > 0 && height > 0 && (
        <svg width={width} height={height} className="block overflow-visible" aria-hidden>
          <defs>
            <linearGradient id="clicks-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-line-soft)" stopOpacity="0.30" />
              <stop offset="55%" stopColor="var(--chart-line-soft)" stopOpacity="0.10" />
              <stop offset="100%" stopColor="var(--chart-line-soft)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grid and the two axes' numbers. Dashed and faint: a rule, not a bar. */}
          {ticks.map((t) => {
            const y = PAD.top + plotH - t * plotH;
            return (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotW}
                  y1={y}
                  y2={y}
                  stroke="var(--neutral-200)"
                  strokeDasharray={t === 0 ? undefined : "3 4"}
                />
                <text
                  x={PAD.left - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-neutral-400 text-[10px] tabular-nums"
                >
                  {Math.round(t * clickMax)}
                </text>
                <text
                  x={PAD.left + plotW + 8}
                  y={y + 3.5}
                  textAnchor="start"
                  className="fill-neutral-400 text-[10px] tabular-nums"
                >
                  {t === 1 && currency ? `${compactMoney(t * barMax)} ${currency.toUpperCase()}` : compactMoney(t * barMax)}
                </text>
              </g>
            );
          })}

          {/* The area first: it is translucent, and anything behind it is
              tinted by it. Then the bars, then the line on top of both. */}
          <g
            className="transition-opacity duration-500 ease-(--ease-out) motion-reduce:transition-none"
            style={{ opacity: drawn ? 1 : 0 }}
          >
            <path d={areaPath} fill="url(#clicks-area)" />
          </g>

          {points.map((p, i) => {
            const gross = grossAt(p);
            if (gross <= 0) return null;
            const full = Math.max(4, baseline - yBars(gross));
            // What the Owner keeps: the sale minus what he owes on it. The
            // commission is the ghosted slice above it, so one bar carries
            // both what came in and what it cost.
            const cost = splitLabel ? commissionAt(p) : 0;
            const kept = Math.max(0, full - (cost / Math.max(gross, 0.01)) * full);
            const lit = hovered === i;
            const x = xAt(i) - barW / 2;
            const glow = lit
              ? "drop-shadow(0 0 9px color-mix(in oklch, var(--chart-bar) 38%, transparent))"
              : "drop-shadow(0 0 0 color-mix(in oklch, var(--chart-bar) 0%, transparent))";
            return (
              <g
                key={p.date}
                className="supaffi-bar transition-[filter] duration-500 ease-(--ease-out) motion-reduce:transition-none"
                style={{ filter: glow, animationDelay: `${Math.min(i * 12, 320)}ms` }}
              >
                {cost > 0 && (
                  <path
                    // Only the slice above what he keeps. Drawn as the whole
                    // bar, its dashed outline ran down both sides of the
                    // solid part as well, which read as a box around the bar
                    // rather than a slice off the top of it.
                    d={barPath(x, baseline - full, barW, full - kept, 5)}
                    className="transition-[fill] duration-500 ease-(--ease-out)"
                    style={{
                      fill: "color-mix(in oklch, var(--chart-bar) 20%, white)",
                      stroke: "color-mix(in oklch, var(--chart-bar) 55%, white)",
                      strokeWidth: 1,
                      strokeDasharray: "3 2.5",
                    }}
                  />
                )}
                <path
                  // Square topped while a ghost sits on it, rounded when it
                  // is the whole bar: a rounded top under the ghost reads as
                  // two bars rather than one divided.
                  d={barPath(x, baseline - kept, barW, kept, cost > 0 ? 0 : 5)}
                  className="transition-[fill] duration-500 ease-(--ease-out) motion-reduce:transition-none"
                  style={{ fill: lit ? "var(--chart-bar-lit)" : "var(--chart-bar)" }}
                />
              </g>
            );
          })}

          <g
            className="transition-opacity duration-500 ease-(--ease-out) motion-reduce:transition-none"
            style={{ opacity: drawn ? 1 : 0, transitionDelay: "120ms" }}
          >
            <path
              d={linePath}
              fill="none"
              stroke="var(--chart-line)"
              strokeWidth="2.25"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>

          {/* The hovered column: a hairline and a dot on the line. */}
          {active && hovered !== null && (
            <g>
              <line
                x1={xAt(hovered)}
                x2={xAt(hovered)}
                y1={PAD.top}
                y2={baseline}
                stroke="var(--neutral-300)"
                strokeDasharray="2 3"
              />
              <circle
                cx={xAt(hovered)}
                cy={yClicks(active.clicks)}
                r="4"
                fill="white"
                stroke="var(--chart-line)"
                strokeWidth="2.25"
              />
            </g>
          )}

          {/* Axis labels. */}
          {points.map((p, i) =>
            labelled.has(i) ? (
              <text
                key={p.date}
                x={xAt(i)}
                y={height - 8}
                textAnchor="middle"
                className="fill-neutral-500 text-[10.5px] tabular-nums"
              >
                {axisLabel(p, bucket)}
              </text>
            ) : null
          )}

          {/* Hit areas, one per bucket, on top of everything. */}
          {points.map((p, i) => (
            <rect
              key={`hit-${p.date}`}
              x={PAD.left + slot * i}
              y={PAD.top}
              width={slot}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </svg>
      )}

      {active && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-1 z-10 w-[220px] -translate-x-1/2 rounded-(--radius) border border-(--card-hairline) bg-white px-3 py-2.5 text-[12px] shadow-(--shadow-md)"
          style={{ left: tooltipX }}
        >
          <p className="mb-1.5 font-medium text-neutral-900">{periodLabel(active, bucket)}</p>
          <dl className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-0.5 w-3 rounded-full bg-(--chart-line)" />
                Clicks
              </dt>
              <dd className="font-medium tabular-nums">{active.clicks}</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <span className="mt-[5px] size-2 shrink-0 self-start rounded-[2px] bg-(--chart-bar)" />
                {barLabel}
              </dt>
              <dd className="flex flex-col items-end font-medium text-neutral-900 tabular-nums">
                {grossLines.length > 0 ? (
                  grossLines.map((line) => <span key={line}>{line}</span>)
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </dd>
            </div>
            {costLines.length > 0 && (
              <div className="flex items-start justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="mt-[5px] size-2 shrink-0 self-start rounded-[2px] border border-dashed border-(--chart-bar) bg-(--chart-bar)/20" />
                  {splitLabel}
                </dt>
                <dd className="flex flex-col items-end font-medium text-neutral-900 tabular-nums">
                  {costLines.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <dt className="pl-[14px] text-muted-foreground">{countLabel}</dt>
              <dd className="font-medium tabular-nums">{active.conversions}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
