"use client";

import { useMemo, useState } from "react";

// Six-month paid-revenue line chart rendered as inline SVG. Zero chart
// library dependency — the payload is always exactly 6 points, so
// rolling our own keeps the ship small (and the markup visible in
// View Source, which helps anyone debugging the chart). Design notes:
//
//   - X axis: 6 labels, 1 per bucket, rendered with font-mono so
//     "Mar 26" lines up below the tick without wobble.
//   - Y axis: implicit. A single dashed baseline at the minimum value
//     + the peak value annotated next to the topmost point. Tooltip
//     shows the exact cents on hover so the rest stays uncluttered.
//   - Area fill: brand-primary at alpha 0.12 — matches the gradient
//     wash at the top of the Today hero so the chart feels like part
//     of the same warm surface, not a stuck-on widget.
//   - Stroke animation: `stroke-dashoffset` from total length → 0 over
//     700ms on mount, respects prefers-reduced-motion via CSS var.
//
// The ViewBox is a fixed 600×200 so the SVG scales cleanly to any
// container width. Clients read the producer default currency from
// the tRPC payload; we honor that for the tooltip formatter.

export type RevenueTrendPoint = { month: string; cents: number };

type Props = {
  points: RevenueTrendPoint[];
  currency: string;
};

// Chart dimensions in SVG user units. Paddings carve out room for
// the X axis labels + the peak annotation on the Y axis. The
// `plotH/plotW` derived values stay in sync if we ever tweak padding.
const W = 600;
const H = 200;
const PAD_X = 16;
const PAD_TOP = 24;
const PAD_BOTTOM = 32;
const plotW = W - PAD_X * 2;
const plotH = H - PAD_TOP - PAD_BOTTOM;

function formatMonthLabel(iso: string): string {
  // "2026-03" → "Mar 26". We render in UTC to match the server's
  // UTC-bucket boundaries; parsing "YYYY-MM-01" avoids local-tz drift
  // that would otherwise shift a Jan-1 bucket into Dec on US/West.
  const [yRaw, mRaw] = iso.split("-");
  const y = Number(yRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return iso;
  const d = new Date(Date.UTC(y, m - 1, 1));
  const short = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${short} ${String(y).slice(-2)}`;
}

function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function RevenueTrend({ points, currency }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Max value anchors the Y scale. When every month is zero we still
  // render a flat baseline at the bottom — a max of 1 prevents a
  // divide-by-zero and draws a legible "no revenue yet" flat line.
  const max = useMemo(
    () => Math.max(1, ...points.map((p) => p.cents)),
    [points],
  );

  // Coordinates for each point. We spread the 6 points across plotW
  // so the first lands at PAD_X + 0 and the last at PAD_X + plotW.
  // Invert the Y axis: cents = max → top; cents = 0 → bottom.
  const coords = useMemo(() => {
    if (points.length === 0) return [] as { x: number; y: number }[];
    const step = points.length > 1 ? plotW / (points.length - 1) : 0;
    return points.map((p, i) => {
      const x = PAD_X + step * i;
      const y = PAD_TOP + plotH - (p.cents / max) * plotH;
      return { x, y };
    });
  }, [points, max]);

  // Path data for the stroke. Straight segments between points — the
  // human eye reads straight lines as "here's what happened each
  // month" more clearly than a spline's smoothed-over rises and dips.
  const linePath = useMemo(() => {
    if (coords.length === 0) return "";
    return coords
      .map((c, i) => `${i === 0 ? "M" : "L"} ${String(c.x)} ${String(c.y)}`)
      .join(" ");
  }, [coords]);

  // Area path closes the line with a baseline along the bottom of the
  // plot, giving us the 12%-alpha brand fill under the curve.
  const areaPath = useMemo(() => {
    if (coords.length === 0) return "";
    const baseline = PAD_TOP + plotH;
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (!first || !last) return "";
    const top = coords
      .map((c, i) => `${i === 0 ? "M" : "L"} ${String(c.x)} ${String(c.y)}`)
      .join(" ");
    return `${top} L ${String(last.x)} ${String(baseline)} L ${String(first.x)} ${String(baseline)} Z`;
  }, [coords]);

  // Peak point for the annotation. When multiple months tie, pick
  // the rightmost so the "your best month" label doesn't jump around
  // when a producer sees a sequence of identical months.
  const peakIdx = useMemo(() => {
    if (points.length === 0) return null;
    let idx = 0;
    for (let i = 0; i < points.length; i += 1) {
      const cur = points[i]?.cents ?? 0;
      const ref = points[idx]?.cents ?? 0;
      if (cur >= ref) idx = i;
    }
    return points[idx]?.cents === 0 ? null : idx;
  }, [points]);

  const hoverPoint = hoverIdx !== null ? points[hoverIdx] : null;
  const hoverCoord = hoverIdx !== null ? coords[hoverIdx] : null;

  // Approximate stroke length for the dashoffset animation. We use
  // the pythagorean distance between consecutive points — close
  // enough for a straight polyline and avoids running getTotalLength()
  // on every mount. CSS handles the animation + reduced-motion.
  const strokeLen = useMemo(() => {
    if (coords.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < coords.length; i += 1) {
      const a = coords[i - 1];
      const b = coords[i];
      if (!a || !b) continue;
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return Math.ceil(total);
  }, [coords]);

  if (points.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="revenue-trend-heading"
      className="relative"
      data-tour-id="revenue-trend"
    >
      <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-[rgb(var(--border-subtle))] pb-2">
        <div>
          <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
            Revenue · 6 months
          </p>
          <h2
            id="revenue-trend-heading"
            className="mt-1 font-display text-lg tracking-tight text-[rgb(var(--fg-primary))]"
          >
            Paid invoices by month
          </h2>
        </div>
        {peakIdx !== null ? (
          <p className="sk-num shrink-0 font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
            peak {formatCents(points[peakIdx]?.cents ?? 0, currency)}
          </p>
        ) : null}
      </div>
      <div className="relative" style={{ height: 200 }}>
        <svg
          role="img"
          aria-label={`Revenue trend over the last 6 months, peak ${formatCents(
            points[peakIdx ?? 0]?.cents ?? 0,
            currency,
          )}`}
          viewBox={`0 0 ${String(W)} ${String(H)}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          onMouseLeave={() => {
            setHoverIdx(null);
          }}
        >
          {/* Y-axis grid guides — three faint horizontal rules at
              25%/50%/75% of the plot height. SVG paint order = source
              order, so these sit BENEATH the area fill + line stroke
              (no z-index in SVG). Subtle enough to disappear into the
              surface when there's data, prominent enough to read as
              "this is graph paper" on the all-zeros empty state. */}
          {[0.25, 0.5, 0.75].map((frac) => (
            <line
              key={`grid-${String(frac)}`}
              x1={PAD_X}
              x2={W - PAD_X}
              y1={PAD_TOP + plotH * frac}
              y2={PAD_TOP + plotH * frac}
              stroke="rgb(var(--border-subtle))"
              strokeOpacity={0.4}
              strokeWidth={1}
            />
          ))}

          {/* Dashed baseline (zero axis). */}
          <line
            x1={PAD_X}
            x2={W - PAD_X}
            y1={PAD_TOP + plotH}
            y2={PAD_TOP + plotH}
            stroke="rgb(var(--border-subtle))"
            strokeDasharray="2 3"
            strokeWidth={1}
          />

          {/* Fill under the curve. */}
          <path
            d={areaPath}
            fill="rgb(var(--brand-primary) / 0.12)"
          />

          {/* The line itself — stroke-dashoffset mount animation is
              parameterized by --sk-trend-length so a reduced-motion
              query can knock it out. */}
          <path
            d={linePath}
            fill="none"
            stroke="rgb(var(--brand-primary))"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="sk-trend-line"
            style={{ ["--sk-trend-length" as string]: String(strokeLen) }}
          />

          {/* Interaction layer: one invisible vertical strip per
              bucket so hovering anywhere in that column highlights
              the corresponding point. Wider than the dot itself so
              the tooltip doesn't require pixel-perfect aim. */}
          {coords.map((c, i) => {
            const stripWidth = plotW / Math.max(1, points.length - 1);
            const left = c.x - stripWidth / 2;
            return (
              <rect
                key={points[i]?.month ?? String(i)}
                x={Math.max(0, left)}
                y={0}
                width={stripWidth}
                height={H}
                fill="transparent"
                onMouseEnter={() => {
                  setHoverIdx(i);
                }}
              />
            );
          })}

          {/* Point dots. The hovered dot gets a larger ring so the
              tooltip has a visual anchor. */}
          {coords.map((c, i) => (
            <circle
              key={`dot-${points[i]?.month ?? String(i)}`}
              cx={c.x}
              cy={c.y}
              r={hoverIdx === i ? 4.5 : 3}
              fill="rgb(var(--bg-base))"
              stroke="rgb(var(--brand-primary))"
              strokeWidth={1.8}
            />
          ))}

          {/* X axis labels. */}
          {coords.map((c, i) => (
            <text
              key={`x-${points[i]?.month ?? String(i)}`}
              x={c.x}
              y={H - 8}
              textAnchor="middle"
              className="fill-[rgb(var(--fg-muted))]"
              style={{ font: "10px ui-monospace, SFMono-Regular, monospace" }}
            >
              {formatMonthLabel(points[i]?.month ?? "")}
            </text>
          ))}
        </svg>

        {/* Tooltip — sits in the HTML layer so it can use the same
            font + color tokens as the rest of the Today surface.
            Positioned relative to the SVG via a percentage translated
            from the hovered point's x coordinate. */}
        {hoverPoint && hoverCoord ? (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: "absolute",
              left: `${String((hoverCoord.x / W) * 100)}%`,
              top: `${String((hoverCoord.y / H) * 100)}%`,
              transform: "translate(-50%, calc(-100% - 10px))",
              pointerEvents: "none",
            }}
            className="whitespace-nowrap rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 py-1 shadow-[var(--shadow-md)]"
          >
            <p className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-[rgb(var(--fg-muted))]">
              {formatMonthLabel(hoverPoint.month)}
            </p>
            <p className="sk-num mt-0.5 font-mono text-sm text-[rgb(var(--fg-primary))]">
              {formatCents(hoverPoint.cents, currency)}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
