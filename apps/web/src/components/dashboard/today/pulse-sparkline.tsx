"use client";

import { useMemo } from "react";

// Ambient 30-day sparkline that sits BEHIND the big revenue number on
// PulseCard. Visual language carries from RevenueTrend (same SVG path
// approach, same sk-trend-line draw-in animation), but at a
// dramatically reduced visual weight: shorter viewBox, low-alpha
// stroke, no axis labels, no tooltips, no peak annotation. This is
// decorative context — the card's focal point is the number, not the
// chart.
//
// Layered with `position: absolute` + `pointer-events-none` so the
// parent <a> stays a clean click target on the whole card surface.

type Props = {
  // Always-30-element array (the server zero-fills missing days). We
  // accept any length for testability but the consumer always feeds 30.
  values: number[];
};

// SVG dimensions in user units. The 600×80 viewBox is much shorter
// than RevenueTrend's 600×200 — sparklines should not compete with
// type. preserveAspectRatio="none" lets the SVG stretch to whatever
// width its container assigns.
const W = 600;
const H = 80;
// No top/bottom padding — the line should breathe to the edges so it
// reads as a "trace" rather than a confined chart. A few pixels of
// stroke half-width are absorbed by the parent container's padding.
const PAD_X = 8;
const plotW = W - PAD_X * 2;

// Pure path builder. Exported for unit-testing the geometry without
// rendering the SVG. Returns an SVG path-data string of the form
//   "M x0 y0 L x1 y1 L x2 y2 …"
//
//   - empty values    → "" (component returns null in that case)
//   - single value    → "M x0 y0" (no L commands, won't render a stroke
//                       but won't crash the SVG either)
//   - all-zero values → flat baseline at y = H, max-floor of 1 keeps
//                       the divisor non-zero so we don't emit NaN
export function buildSparklinePath(values: number[]): string {
  if (values.length === 0) return "";
  // Floor the max at 1 so an all-zero sparkline still produces real
  // numeric coordinates (avoids `0 / 0 → NaN` in the y-projection).
  const max = Math.max(1, ...values);
  // Spread values across plotW so the first lands at x = PAD_X and the
  // last at x = PAD_X + plotW. With a single value, step = 0 and the
  // point pins to PAD_X.
  const step = values.length > 1 ? plotW / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = PAD_X + step * i;
      // Invert Y: max → top (y = 0), 0 → bottom (y = H). The line
      // grows upward, matching the reading direction of "growth".
      const y = H - (v / max) * H;
      const cmd = i === 0 ? "M" : "L";
      return `${cmd} ${String(x)} ${String(y)}`;
    })
    .join(" ");
}

// Approximate stroke length for the dashoffset draw-in animation. We
// use the pythagorean distance between consecutive points — close
// enough for a polyline (no curves) and avoids running
// SVGPathElement.getTotalLength() on every mount. Same trick as
// RevenueTrend.
function strokeLengthFor(values: number[]): number {
  if (values.length < 2) return 0;
  const max = Math.max(1, ...values);
  const step = plotW / (values.length - 1);
  let total = 0;
  for (let i = 1; i < values.length; i += 1) {
    const ax = PAD_X + step * (i - 1);
    const bx = PAD_X + step * i;
    const ay = H - ((values[i - 1] ?? 0) / max) * H;
    const by = H - ((values[i] ?? 0) / max) * H;
    total += Math.hypot(bx - ax, by - ay);
  }
  return Math.ceil(total);
}

export function PulseSparkline({ values }: Props) {
  const path = useMemo(() => buildSparklinePath(values), [values]);
  const strokeLen = useMemo(() => strokeLengthFor(values), [values]);

  // No values → no SVG. The card-level empty-state branch already
  // hides the sparkline when the producer has no revenue, but we
  // belt-and-brace it here.
  if (path === "") return null;

  return (
    // Absolute layer beneath the big number. inset-0 fills the card's
    // content area; pointer-events-none ensures the parent <a>
    // collects every click. aria-hidden — the chart is decorative;
    // the number itself is the semantic content.
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        <path
          d={path}
          fill="none"
          // Brand-primary at alpha 0.4 so the line reads as ambient
          // context, not a primary axis. The /0.4 form keeps the
          // alpha scoped to this stroke without redefining the token.
          stroke="rgb(var(--brand-primary) / 0.4)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          // Same draw-in keyframe as RevenueTrend, gated by the same
          // prefers-reduced-motion @media block in globals.css.
          className="sk-trend-line"
          style={{ ["--sk-trend-length" as string]: String(strokeLen) }}
        />
      </svg>
    </div>
  );
}
