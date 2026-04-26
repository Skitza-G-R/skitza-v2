# Story 02 — `PulseCard` component

**Epic:** Today redesign 2026-04-25
**Depends on:** Story 01 (`pulseStats` payload).
**Blocks:** Story 06 (page rebuild).
**Subagent:** `skitza-tdd-implementer`

## Goal

Replace KpiStrip + RevenueTrend on Today with one `PulseCard`: a single editorial card showing one big number (revenue this month), a delta vs last month, an ambient 30-day sparkline behind the number, and a footer row of three small mono stats.

## User story

As a producer, when I look at Today, I want one glance at my month-to-date revenue with a clear sense of whether I'm trending up or down — not a wall of zeros across four KPIs.

## Acceptance criteria

- [ ] New file `apps/web/src/components/dashboard/today/pulse-card.tsx`.
- [ ] Renders **one big display-font number** (`font-display text-4xl sm:text-5xl`) — the `thisMonthCents` formatted with `Intl.NumberFormat` in the producer's `currency`.
- [ ] If `thisMonthCents === 0 && lastMonthCents === 0`, render `—` instead of `$0`. No empty-formatted zero.
- [ ] Renders a delta line below the big number: `+12% vs March` (green) or `-8% vs March` (red/warning) or `— vs March` (muted, when `deltaPct === null`).
- [ ] Sparkline renders behind the big number using absolute positioning + alpha 0.4 brand-primary stroke. SVG inline. 30 points.
- [ ] Footer row: 3 mono small-caps stats separated by `·`: `5 active · 3 sessions · 2 unresolved`. Reads `0 active · 0 sessions · 0 unresolved` when zeros (NOT `—` — these are countable units, not currency).
- [ ] Whole card is a clickable link to `/dashboard/revenue`.
- [ ] Hover state: `sk-lift` lift + brand-primary border accent (matches the polished primary-button pattern).
- [ ] No new design tokens. CSS variables only. No new dependencies.
- [ ] Sub-component `pulse-sparkline.tsx` rolls SVG path the same way `revenue-trend.tsx` does (visual language carries).
- [ ] Reduced-motion: sparkline mount animation respects `prefers-reduced-motion` via `sk-trans` primitive.
- [ ] `/skitza-verify` passes; new component test covers empty state, populated state, negative-delta state, null-delta state.

## Technical context

### Files to create

- `apps/web/src/components/dashboard/today/pulse-card.tsx`
- `apps/web/src/components/dashboard/today/pulse-sparkline.tsx`
- `apps/web/src/components/dashboard/today/__tests__/pulse-card.test.tsx`

### Props

```ts
import type { PulseStats } from "~/server/trpc/routers/producer";

interface PulseCardProps {
  stats: PulseStats;
}
```

### Visual layout

```
┌───────────────────────────────────────────────────────────┐
│ THIS MONTH · PULSE                                        │
│                                                           │
│ ₪ 4,200          ╱╲╱╲___                                  │
│ Revenue · April  +12% vs March                            │
│ ─────────────────────────────────────────────────────     │
│ 5 active · 3 sessions · 2 unresolved                      │
└───────────────────────────────────────────────────────────┘
```

The sparkline is positioned absolutely *behind* the big number — it's ambient context, not the focal point. Use `pointer-events-none` so the card click-target stays clean.

### Sparkline shape

Same SVG approach as `revenue-trend.tsx`:
- ViewBox 600×80 (much shorter than the deep chart — ambient)
- 30 path points, straight `L` segments
- Stroke `rgb(var(--brand-primary))` at `stroke-opacity="0.4"` so it doesn't compete with the number
- No axis labels, no tooltips, no peak annotation — this is decorative
- `sk-trend-line` class for the dashoffset mount animation

### Currency formatting

```ts
const formatCents = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
```

Same pattern as KpiStrip's `format` function. Hebrew locale displays correctly via Intl.

### Delta line tone

- `deltaPct > 0` → `text-[rgb(var(--fg-success))]` (green) — check `globals.css` for the existing token; if `--fg-success` doesn't exist, use brand-primary
- `deltaPct < 0` → `text-[rgb(var(--fg-warning))]` (orange-ish, already used by KpiStrip's unresolved-warn tone)
- `deltaPct === null` → `text-[rgb(var(--fg-muted))]` with `— vs <month>` copy

The previous month's name is derived from `(now().getMonth() - 1)` → `Intl` short-month (`"March"`). Use UTC to match the server.

### Footer counts copy

Use plain English: `"5 active · 3 sessions · 2 unresolved"`. Drop the eyebrow labels; the numbers + the `·` separators carry meaning. Mono font, `text-[rgb(var(--fg-muted))]`, small-caps tracking.

i18n: skip for now — these strings are inline in en. Hebrew is a follow-up (Story 6 cleanup).

## TDD steps

1. **RED** — write `pulse-card.test.tsx` with 4 fixtures: zero state (all zeros), positive-delta state, negative-delta state, null-delta state. Assert: big number formatted correctly, delta line tone matches, footer counts render. Run — fails (component doesn't exist).
2. **GREEN** — implement `PulseCard` + `PulseSparkline`. Run — green.
3. **RED** — add reduced-motion test: `prefers-reduced-motion: reduce` should kill the sparkline mount animation (assert via `getComputedStyle` or class presence). Run — may fail if sk-trans-line wasn't applied with the right gate.
4. **GREEN** — verify the `sk-trend-line` class is wired to the reduced-motion CSS gate in `globals.css`.
5. `/skitza-verify`.

## Commit message

```
feat(today): PulseCard — single editorial revenue card with sparkline + delta

Replaces the KpiStrip + RevenueTrend pair on Today with one card that
answers the producer's "how am I doing this month?" question at a glance:
big revenue number in the producer's default currency, +/- vs last
month delta with tone (green / warning / muted), 30-day sparkline
ambient behind the number, footer row with active projects /
sessions next 7 days / unresolved items.

Click target navigates to /dashboard/revenue (Story 7) for the deep
chart.

Empty state: "—" instead of "$0" when both this month and last
month are zero. Footer counts read "0 active · 0 sessions · 0
unresolved" regardless (countable units, not currency).

Story 02 of the today-redesign epic. Component is integrated into
the Today page in Story 06; this story ships the component + tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
