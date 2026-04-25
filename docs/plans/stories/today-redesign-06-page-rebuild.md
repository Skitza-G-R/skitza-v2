# Story 06 — Today page rebuild + cleanup of retired components

**Epic:** Today redesign 2026-04-25
**Depends on:** Stories 01–05 (data + components ready).
**Blocks:** Story 07 (the revenue route can ship in parallel; this story removes the chart from Today).
**Subagent:** `skitza-tdd-implementer`

## Goal

Rewrite [`apps/web/src/app/(app)/dashboard/page.tsx`](../../apps/web/src/app/(app)/dashboard/page.tsx) to use the new components in the new order (inbox first, recent uploads middle, pulse + actions bottom), and delete the components that are no longer used. Add the day-1 empty-state onboarding card.

## User story

As a producer, when I open `/dashboard`, I want the page to be structured around my actual workflow: respond → produce → status. Not around what the codebase happens to render.

## Acceptance criteria

- [ ] Today page renders three sections in this order:
  1. `<InboxSection>` (extracted from current `today-view.tsx` — was the bottom section, now top)
  2. `<RecentUploadsShelf uploads={data.recentUploads} />`
  3. `<PulseCard stats={data.pulseStats} />` followed by `<ContextualActions ...props />`
- [ ] Greeting at the top: `<DashboardGreeting />` — renders `"Today, Friday April 25"` (date) + a one-line summary `"Welcome back — N things need you."` (or `"All quiet today."` when `unresolvedItems === 0`).
- [ ] **Day-1 empty state**: when `recentUploads.length === 0 && pulseStats.activeProjects === 0 && items.length === 0` (and the existing `showSetupNudge` predicate is false), render a single `<DashboardEmptyOnboarding />` card centered with breathing space:
  - "Your first booking is one share away."
  - The share-link chip + copy button (reusing logic from Story 05's `SidebarShareChip` if extractable, else inline)
  - One CTA: "Customize your /join page" → `/dashboard/settings?section=profile`
- [ ] Files **deleted** (no orphaned imports):
  - `apps/web/src/components/dashboard/today/share-link-card.tsx`
  - `apps/web/src/components/dashboard/today/quick-actions.tsx`
  - `apps/web/src/components/dashboard/today/kpi-strip.tsx`
  - `apps/web/src/components/dashboard/today/revenue-trend.tsx` (moved to revenue route in Story 07; this story imports from the new location, or Story 07 must complete first)
  - `apps/web/src/components/dashboard/today/__tests__/quick-actions-pills.test.ts` (the polish-pass test — its assertions don't apply to the new ContextualActions)
  - `apps/web/src/app/(app)/dashboard/quick-note-actions.ts` is **kept** — Quick note still exists in the ⌘K palette flow.
- [ ] `producer.today` payload's `kpis` field can now be removed if no other consumer uses it (search the codebase first; if `KpiStrip` was its only consumer, drop it from the procedure too — saves one fan-out leg).
- [ ] i18n: `quickActions` namespace in en.json + he.json is removed (or repurposed) — the QuickActions component is gone. ContextualActions strings can stay inline in en for v1 (Hebrew added in a later pass).
- [ ] `/skitza-verify` passes — typecheck, lint, all tests including the new tests from Stories 01–05.
- [ ] Visual: dispatch `skitza-ux-critic` subagent for a UX review of the new Today against the Samply / Spotify-for-Artists / Linear benchmark.

## Technical context

### File: `apps/web/src/app/(app)/dashboard/page.tsx`

The data fetch already calls `caller.producer.today()` — Story 01 adds `recentUploads` + `pulseStats` to that payload, so no new tRPC calls. Reuse the existing `Promise.all` for `today + me + projectList + revenueTrend`.

**Note:** `revenueTrend` is no longer needed on Today (the chart moves to `/dashboard/revenue`). Drop that fetch leg here.

### Empty-state predicate

```ts
const isDayOneEmpty =
  data.recentUploads.length === 0 &&
  pulseStats.activeProjects === 0 &&
  data.items.length === 0;

// Render order:
// 1. FinishSetupNudge (existing — fires when skipper)
// 2. DashboardEmptyOnboarding (when isDayOneEmpty && !showSetupNudge)
// 3. Populated layout otherwise
```

### `DashboardGreeting`

New small component or inline JSX in the page. Reads:
- Date via `Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(now)` → `"Friday, April 25"`
- Summary: `unresolvedItems === 0 ? "All quiet today." : `${unresolvedItems} thing${s} need${s} you.``

### `InboxSection` extraction

The current `TodayView` has the inbox layout (split list + detail). Extract into a separate `InboxSection` component that takes `items` + `selectedItemId` + renders the existing layout. The page now calls `<InboxSection ... />` directly.

### Cleanup

After the refactor, `today-view.tsx` may be empty or trivial — delete it if so, and inline its remaining code into `page.tsx`.

## TDD steps

1. **RED** — `today-page.test.ts` (or upgrade the existing `dashboard/__tests__/layout-architecture.test.ts`). Assert: page renders InboxSection first, then RecentUploadsShelf, then PulseCard + ContextualActions.
2. **GREEN** — rebuild `page.tsx` with the new structure.
3. **RED** — empty-state test: with all-zero data, render `DashboardEmptyOnboarding` only (none of the populated sections).
4. **GREEN** — implement empty-state predicate + component.
5. Delete the retired files (`share-link-card.tsx`, `quick-actions.tsx`, `kpi-strip.tsx`, `quick-actions-pills.test.ts`).
6. Verify no remaining imports of deleted files: `grep -r "share-link-card\|quick-actions\|kpi-strip" apps/web/src` should return zero hits.
7. `/skitza-verify`.
8. Dispatch UX-critic subagent on `apps/web/src/app/(app)/dashboard/page.tsx` + the new components for a Samply/Spotify-for-Artists benchmark review.

## Commit message

```
feat(today): rebuild page — invert hierarchy, retire 4 components, add empty state

Replaces the prior layout (ShareLinkCard hero → 8-button QuickActions →
4-KPI strip → 6-month chart → inbox below the fold) with three
sections in workflow order: inbox first → recent uploads middle →
pulse + contextual actions bottom.

Day-1 empty state: when there are no projects, uploads, or inbox
items, the populated layout is replaced entirely with a single
centered onboarding card pointing the producer at their share link.
No wall of zeros. Populated layout returns automatically when data
exists.

Greeting at top of page: "Today, Friday April 25 — N things need you"
(or "All quiet today" when zero).

Files deleted (no orphans):
- ShareLinkCard (share moved to sidebar footer in Story 05)
- QuickActions (replaced by ContextualActions in Story 04)
- KpiStrip (folded into PulseCard in Story 02)
- RevenueTrend (moved to /dashboard/revenue in Story 07)
- quick-actions-pills.test.ts (PR #47 polish-pass test, no longer applicable)

Story 06 of the today-redesign epic. Closes the redesign loop —
Stories 01-05 ship the data + components, this story integrates
and cleans up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
