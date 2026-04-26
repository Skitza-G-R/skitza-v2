# Story 07 — `/dashboard/revenue` route hosting the deep chart

**Epic:** Today redesign 2026-04-25
**Depends on:** none (parallel-safe with Stories 02–06).
**Blocks:** Story 06 (page rebuild needs the new chart location to exist before deleting the old `revenue-trend.tsx` from Today).
**Subagent:** `skitza-tdd-implementer`

## Goal

Create a new authenticated route `/dashboard/revenue` that hosts the existing `RevenueTrend` 6-month chart at a more breathable size (vertical, ~600×400, no aspect-ratio stretching). The Pulse card on Today (Story 02) navigates here on click.

## User story

As a producer, when I want to see how my revenue trended over the last 6 months, I want a dedicated page where the chart has room to breathe — instead of a stretched 16:5 horizon on the dashboard.

## Acceptance criteria

- [ ] New file `apps/web/src/app/(app)/dashboard/revenue/page.tsx` (server component).
- [ ] Page calls `caller.producer.revenueTrend()` (existing tRPC query — no changes).
- [ ] Page renders `<RevenueTrend>` at full breathable size — drop `preserveAspectRatio="none"` so the chart maintains correct vertical proportions.
- [ ] Move `revenue-trend.tsx` from `apps/web/src/components/dashboard/today/` to `apps/web/src/components/dashboard/revenue/`. Update all imports.
- [ ] Adjust the chart's SVG viewBox + container height so it renders at ~400px tall instead of the old 200px Today inline. Width fills the container.
- [ ] Page header: eyebrow `REVENUE`, H1 `Last 6 months of paid invoices`. Same typographic hierarchy as the Setup pages.
- [ ] Empty state on the page: when `points.every(p => p.cents === 0)`, show the chart with the Y-axis grid guides + a centered message: "No paid invoices yet. Your chart fills up when invoices get paid." (Different from Today's Pulse card, which is ambient — this page is the dedicated drill-down, so a small empty-state message is OK.)
- [ ] Add a back-link in the page header: `← Back to Today` linking to `/dashboard`.
- [ ] Page is keyboard-accessible: focusable, no traps. Tab order matches DOM order.
- [ ] `/skitza-verify` passes; new test `revenue-page.test.ts` asserts the page renders + the chart imports resolve.
- [ ] Sidebar nav doesn't add a top-level entry for /dashboard/revenue — it's a drill-down from Today's Pulse card, not a peer of Today/Music/Projects/Setup.

## Technical context

### Files to create

- `apps/web/src/app/(app)/dashboard/revenue/page.tsx`
- `apps/web/src/components/dashboard/revenue/revenue-trend.tsx` (moved from `today/`)
- `apps/web/src/components/dashboard/revenue/__tests__/revenue-page.test.ts`

### Files to edit

- Any file importing `from "~/components/dashboard/today/revenue-trend"` → update to `from "~/components/dashboard/revenue/revenue-trend"`.

### Page render

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

import { RevenueTrend } from "~/components/dashboard/revenue/revenue-trend";
import { appRouter } from "~/server/trpc/routers/_app";

export default async function RevenuePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const { points, currency } = await caller.producer.revenueTrend();

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-8 pb-10 sm:px-8 lg:px-12 lg:pt-12">
      <Link
        href="/dashboard"
        className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--brand-primary))]"
      >
        ← Back to Today
      </Link>
      <header className="mt-6 mb-10">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
          Revenue
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[rgb(var(--fg-primary))] sm:text-4xl">
          Last 6 months of paid invoices
        </h1>
      </header>
      <div className="mx-auto max-w-[800px]">
        <RevenueTrend points={points} currency={currency} />
      </div>
    </div>
  );
}
```

### Chart adjustments

In the moved `revenue-trend.tsx`:
- Bump container `style={{ height: 400 }}` (was 200)
- Drop `preserveAspectRatio="none"` from the SVG — let it scale proportionally
- Increase font sizes for X axis labels (from 10px to 12px) since the chart is now bigger
- Keep the Y-axis grid guides from PR #47

## TDD steps

1. Move file: `git mv apps/web/src/components/dashboard/today/revenue-trend.tsx apps/web/src/components/dashboard/revenue/revenue-trend.tsx`.
2. Search for imports: `grep -r "today/revenue-trend" apps/web/src` — update each hit to `revenue/revenue-trend`.
3. **RED** — write `revenue-page.test.ts` assertion: file exists, default export is a React component, page imports `RevenueTrend` from the new location.
4. **GREEN** — create the page file.
5. **RED** — assert the page's container max-width matches the spec (800px chart container).
6. **GREEN** — verify in render output.
7. `/skitza-verify`.

## Commit message

```
feat(dashboard): /dashboard/revenue route — deep 6-month chart with breathing room

Hosts the 6-month paid-invoice line chart on a dedicated route so it
can render at proper proportions (~600×400, no aspect-ratio stretching)
instead of the squished 16:5 inline horizon it was on Today.

The Pulse card on Today (Story 02) is the click target into this
page. No new tRPC procedures — reuses the existing producer.revenueTrend
query unchanged.

Page header: eyebrow REVENUE + H1 "Last 6 months of paid invoices",
back-link to Today, chart centered in 800px container.

Component moved: apps/web/src/components/dashboard/today/revenue-trend.tsx
→ apps/web/src/components/dashboard/revenue/revenue-trend.tsx. All
imports updated.

For v1: chart only, no toggles, no MoM/YoY, no export. Drill-down
features deferred to a future polish pass.

Story 07 of the today-redesign epic. Parallel-safe with Stories 02–05;
must complete before Story 06's deletion sweep.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
