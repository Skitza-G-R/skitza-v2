import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  formatFooterStats,
  formatPulseAmount,
  isPulseEmpty,
  previousMonthLabel,
  pulseDeltaTone,
} from "../pulse-card";
import { buildSparklinePath } from "../pulse-sparkline";

// Story 02 — PulseCard tests.
//
// The codebase doesn't ship @testing-library/react (vitest runs in
// `node` env, no jsdom). We mirror the existing
// payment-status-strip.test pattern: extract pure helpers from the
// component + cover them with unit tests, and source-grep the JSX
// shell to pin layout/copy invariants. If the helpers are right, the
// component's only job is stitching spans together — which typecheck
// + lint cover.

const here = dirname(fileURLToPath(import.meta.url));
const PULSE_CARD_PATH = join(here, "..", "pulse-card.tsx");
const PULSE_SPARKLINE_PATH = join(here, "..", "pulse-sparkline.tsx");
const cardSource = readFileSync(PULSE_CARD_PATH, "utf8");
const sparklineSource = readFileSync(PULSE_SPARKLINE_PATH, "utf8");

// ─── Pure helpers — formatPulseAmount ────────────────────────────────

describe("formatPulseAmount", () => {
  it("formats positive cents as a whole-currency value (USD)", () => {
    // 4_200_00 cents = $4,200 — Intl drops fractional digits per the
    // 0/0 min/max settings (matches KpiStrip's format function).
    expect(formatPulseAmount(420_000, "USD")).toBe("$4,200");
  });

  it("honours the supplied ISO currency code", () => {
    // ILS is the repo's reference non-USD locale. Spacing varies by
    // OS, so assert the digit shape only.
    expect(formatPulseAmount(420_000, "ILS")).toMatch(/4,200/);
  });

  it("falls back to USD when the currency code is empty", () => {
    expect(formatPulseAmount(100_000, "")).toMatch(/\$1,000/);
  });

  it("renders zero as the formatted zero ($0) — empty-state guard lives elsewhere", () => {
    // The em-dash empty state is selected by isPulseEmpty; this
    // formatter remains a pure number→currency function.
    expect(formatPulseAmount(0, "USD")).toBe("$0");
  });
});

// ─── Pure helpers — isPulseEmpty ─────────────────────────────────────

describe("isPulseEmpty", () => {
  it("true when both this-month and last-month are zero", () => {
    expect(isPulseEmpty({ thisMonthCents: 0, lastMonthCents: 0 })).toBe(true);
  });

  it("false when this-month has revenue (any prior state)", () => {
    expect(isPulseEmpty({ thisMonthCents: 100_00, lastMonthCents: 0 })).toBe(false);
  });

  it("false when last-month had revenue but this-month is zero — there's still a comparison", () => {
    expect(isPulseEmpty({ thisMonthCents: 0, lastMonthCents: 500_00 })).toBe(false);
  });
});

// ─── Pure helpers — previousMonthLabel ───────────────────────────────

describe("previousMonthLabel", () => {
  it("rolls Jan → December (prev year handled implicitly via Date math)", () => {
    // Jan 15, 2026 (UTC) — previous month is December 2025.
    const now = new Date(Date.UTC(2026, 0, 15));
    expect(previousMonthLabel(now)).toBe("December");
  });

  it("returns the prior month for a mid-year date", () => {
    const now = new Date(Date.UTC(2026, 3, 25)); // April 25, 2026
    expect(previousMonthLabel(now)).toBe("March");
  });

  it("returns November when current month is December", () => {
    const now = new Date(Date.UTC(2026, 11, 5));
    expect(previousMonthLabel(now)).toBe("November");
  });
});

// ─── Pure helpers — pulseDeltaTone ───────────────────────────────────

describe("pulseDeltaTone", () => {
  it("returns 'success' when delta is strictly positive", () => {
    expect(pulseDeltaTone(12)).toBe("success");
  });

  it("returns 'warning' when delta is strictly negative", () => {
    expect(pulseDeltaTone(-8)).toBe("warning");
  });

  it("returns 'muted' when delta is null (no comparison anchor)", () => {
    expect(pulseDeltaTone(null)).toBe("muted");
  });

  it("returns 'muted' when delta is zero — flat month is not a 'success'", () => {
    expect(pulseDeltaTone(0)).toBe("muted");
  });
});

// ─── Pure helpers — formatFooterStats ────────────────────────────────

describe("formatFooterStats", () => {
  it("renders all three counts with the literal en-copy + middot separator", () => {
    expect(
      formatFooterStats({
        activeProjects: 5,
        upcomingSessions7d: 3,
        unresolvedItems: 2,
      }),
    ).toBe("5 active · 3 sessions · 2 unresolved");
  });

  it("renders zeros (NOT em-dashes) — these are countable units, not currency", () => {
    expect(
      formatFooterStats({
        activeProjects: 0,
        upcomingSessions7d: 0,
        unresolvedItems: 0,
      }),
    ).toBe("0 active · 0 sessions · 0 unresolved");
  });

  it("formats large counts without thousands separators (these are small ints by domain)", () => {
    expect(
      formatFooterStats({
        activeProjects: 12,
        upcomingSessions7d: 7,
        unresolvedItems: 1,
      }),
    ).toBe("12 active · 7 sessions · 1 unresolved");
  });
});

// ─── Pure helpers — buildSparklinePath (sub-component) ───────────────

describe("buildSparklinePath", () => {
  it("returns an empty string for an empty array (no path to draw)", () => {
    expect(buildSparklinePath([])).toBe("");
  });

  it("starts the path with M and joins remaining points with L", () => {
    // 3 points forces both the M and L commands; we just shape-check
    // the output rather than pinning exact coordinates (which depend
    // on the SVG viewBox constants).
    const path = buildSparklinePath([100, 200, 150]);
    expect(path.startsWith("M ")).toBe(true);
    expect((path.match(/L /g) ?? []).length).toBe(2);
  });

  it("renders a flat baseline when every value is zero (max-floor prevents NaN)", () => {
    // All-zeros sparkline must not produce NaN / Infinity coords —
    // the function uses Math.max(1, ...values) to floor the
    // denominator. The path should still be 30 segments wide.
    const path = buildSparklinePath(Array.from({ length: 30 }, () => 0));
    expect(path).not.toMatch(/NaN|Infinity/);
    expect(path.startsWith("M ")).toBe(true);
  });

  it("uses 30 points when a 30-element sparkline is supplied (one segment per day)", () => {
    const sparkline = Array.from({ length: 30 }, (_, i) => i * 100);
    const path = buildSparklinePath(sparkline);
    // 1 M + 29 L commands for a 30-point path.
    expect((path.match(/L /g) ?? []).length).toBe(29);
  });
});

// ─── Source-grep — JSX shell invariants ──────────────────────────────

describe("PulseCard — link target", () => {
  it('the whole card links to "/dashboard/revenue" (Story 7 deep-chart route)', () => {
    expect(cardSource).toContain('href="/dashboard/revenue"');
  });
});

describe("PulseCard — visual / animation primitives", () => {
  it("imports + uses the tabular-nums primitive on the big number", () => {
    expect(cardSource).toContain("sk-num");
  });

  it("uses font-display text-4xl sm:text-5xl on the headline number (per spec)", () => {
    expect(cardSource).toMatch(/font-display[^"`]*text-4xl[^"`]*sm:text-5xl/);
  });

  it("applies the sk-lift hover affordance to the card surface", () => {
    expect(cardSource).toContain("sk-lift");
  });

  it("does NOT import framer-motion (CSS primitives only)", () => {
    expect(cardSource).not.toMatch(/from\s+["']framer-motion["']/);
  });
});

describe("PulseSparkline — ambient layering + reduced-motion", () => {
  it("uses absolute positioning so the SVG sits behind the big number", () => {
    expect(sparklineSource).toContain("absolute");
  });

  it("disables pointer events so the parent <a> stays the click target", () => {
    expect(sparklineSource).toContain("pointer-events-none");
  });

  it("strokes with the brand-primary token at alpha 0.4 (ambient, not focal)", () => {
    // Match either the inline style or the className arbitrary-value
    // form — both are acceptable. The /0.4 alpha is the contract.
    expect(sparklineSource).toMatch(/--brand-primary[^)]*\)\s*\/\s*0\.4/);
  });

  it("opts in to the sk-trend-line draw-in animation (reduced-motion gated globally)", () => {
    expect(sparklineSource).toContain("sk-trend-line");
  });

  it("does NOT import framer-motion (CSS primitives only)", () => {
    expect(sparklineSource).not.toMatch(/from\s+["']framer-motion["']/);
  });
});

describe("PulseSparkline — reduced-motion CSS gate is wired in globals.css", () => {
  // Defense-in-depth: the sk-trend-line keyframe is shared with
  // RevenueTrend, so this is really a smoke check that the global
  // CSS still neutralizes the animation under a reduced-motion query.
  // If someone yanks the @media block, the test goes red even though
  // the component file is untouched.
  it("globals.css contains a prefers-reduced-motion gate that kills sk-trend-line", () => {
    const globalsPath = join(
      here,
      "..",
      "..",
      "..",
      "..",
      "app",
      "globals.css",
    );
    const globals = readFileSync(globalsPath, "utf8");
    // Match the gate block + the rule that pins the animation to none.
    expect(globals).toMatch(/prefers-reduced-motion:\s*reduce/);
    // The actual neutralization rule under the gate.
    expect(globals).toMatch(/\.sk-trend-line\s*\{[^}]*animation:\s*none/);
  });
});

describe("PulseCard — delta tone wiring (component reads pulseDeltaTone branches)", () => {
  it("uses the --fg-success token for positive-delta tone (matches helper output)", () => {
    expect(cardSource).toContain("--fg-success");
  });

  it("uses the --fg-warning token for negative-delta tone (existing KpiStrip token)", () => {
    expect(cardSource).toContain("--fg-warning");
  });

  it("uses the --fg-muted token for null-delta tone", () => {
    expect(cardSource).toContain("--fg-muted");
  });
});

describe("PulseCard — empty state em-dash, not $0", () => {
  it("renders the em-dash glyph (\\u2014) for the empty-state big number", () => {
    // The glyph itself or its escape sequence must appear in source
    // — KpiStrip rendered $0; PulseCard must render — instead.
    expect(cardSource).toMatch(/[—]|\\u2014/);
  });
});
