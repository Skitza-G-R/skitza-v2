# Today redesign — Architecture

**Brief:** [2026-04-25-today-redesign-brief.md](./2026-04-25-today-redesign-brief.md)
**PRD:** §4.1 (updated in this same commit)

This doc tells subagents *exactly* what to build and how. Cite file paths, type names, query shapes, test assertions. No vibes.

---

## Data layer

### Schema — no migrations

The redesign uses only existing columns. Confirmed in [schema.ts](../../packages/db/src/schema.ts):

- [`projects`](../../packages/db/src/schema.ts#L343) (`id`, `producerId`, `clientName`, `stage`, `updatedAt`, …)
- [`projectTracks`](../../packages/db/src/schema.ts#L409) (`id`, `projectId`, `title`, `artist`, `position`, `createdAt`)
- [`trackVersions`](../../packages/db/src/schema.ts#L424) (`id`, `trackId`, `label`, `audioUrl`, `audioR2Key`, `peaksR2Key`, `uploadedAt`, `approvedAt`)
- [`trackComments`](../../packages/db/src/schema.ts#L447) (`id`, `versionId`, `authorName`, `fromProducer`, `resolvedAt`, `createdAt`)
- [`invoices`](../../packages/db/src/schema.ts) (existing — used by Pulse for the delta vs last month)

**No `cover_art_url` column.** Cover art on the recent-uploads shelf is rendered client-side as a deterministic gradient indexed by `trackId`. See `apps/web/src/components/audio/track-cover.tsx` (new component, Story 3).

### tRPC — extend `producer.today`

[`apps/web/src/server/trpc/routers/producer.ts`](../../apps/web/src/server/trpc/routers/producer.ts#L225) — add **two** new fan-out legs to the existing `Promise.all`:

#### Leg 10 — `recentUploads`

```ts
ctx.db
  .select({
    versionId: trackVersions.id,
    trackId: projectTracks.id,
    title: projectTracks.title,
    versionLabel: trackVersions.label,
    uploadedAt: trackVersions.uploadedAt,
    audioUrl: trackVersions.audioUrl,
    durationMs: trackVersions.durationMs,
    projectId: projects.id,
    projectClientName: projects.clientName,
    projectStage: projects.stage,
  })
  .from(trackVersions)
  .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
  .innerJoin(projects, eq(projects.id, projectTracks.projectId))
  .where(
    and(
      eq(projects.producerId, ctx.producerId),
      inArray(projects.stage, [...ACTIVE_STAGES]),  // exclude archived/cancelled
      isNotNull(trackVersions.audioUrl),            // skip uploads still in flight
    ),
  )
  .orderBy(desc(trackVersions.uploadedAt))
  .limit(7),  // 5 visible + 2 buffer for scroll
```

For each row, follow up with a count of unread artist comments since `uploadedAt`:

```ts
// Sub-query — performed inline after the main fetch, sequentially.
// 7 rows × 1 comment-count query = 7 round-trips MAX. For Today's
// p95 latency budget (~120ms), this is acceptable. If the count climbs,
// we batch via a single GROUP BY query in a follow-up pass.
const unreadCommentsSince = await Promise.all(
  rows.map((r) =>
    ctx.db
      .select({ id: trackComments.id })
      .from(trackComments)
      .where(
        and(
          eq(trackComments.versionId, r.versionId),
          eq(trackComments.fromProducer, false),       // artist-side only
          isNull(trackComments.resolvedAt),
          gte(trackComments.createdAt, r.uploadedAt),
        ),
      ),
  ),
);
```

Output shape:

```ts
type RecentUpload = {
  versionId: string
  trackId: string
  title: string                  // "Sunset Mix"
  versionLabel: string           // "v3" | "Master" | "Rough"
  uploadedAt: Date
  audioUrl: string               // R2 URL — never null after the isNotNull filter
  durationMs: number | null
  projectId: string
  projectClientName: string      // "Bob's EP"
  projectStage: ProjectStage
  unreadComments: number         // from artist, unresolved, posted after uploadedAt
}
```

#### Leg 11 — `pulseStats`

```ts
// Last month boundaries — paid invoices in [lastMonthStart, monthStart).
const lastMonthStart = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
);

// Two parallel sub-queries:
const [thisMonthRows, lastMonthRows] = await Promise.all([
  // (re-uses leg 2's revenueRows — already fetched)
  Promise.resolve(revenueRows),
  ctx.db
    .select({ amountCents: invoices.amountCents, currency: invoices.currency })
    .from(invoices)
    .where(
      and(
        eq(invoices.producerId, ctx.producerId),
        eq(invoices.status, "paid"),
        gte(invoices.paidAt, lastMonthStart),
        lte(invoices.paidAt, monthStart),
      ),
    ),
]);
```

For the **30-day sparkline**, fetch daily revenue buckets:

```ts
ctx.db
  .select({
    day: sql<string>`date_trunc('day', ${invoices.paidAt})::date`,
    cents: sql<number>`COALESCE(SUM(${invoices.amountCents}), 0)::integer`,
  })
  .from(invoices)
  .where(
    and(
      eq(invoices.producerId, ctx.producerId),
      eq(invoices.status, "paid"),
      gte(invoices.paidAt, sql`now() - interval '30 days'`),
    ),
  )
  .groupBy(sql`date_trunc('day', ${invoices.paidAt})`),
```

Then on the server, project to a fixed-length 30-element array (one entry per day, zero-fill missing days) before serializing to the client.

Output shape:

```ts
type PulseStats = {
  // The "big number" (this month, in producer's default currency).
  thisMonthCents: number
  lastMonthCents: number
  currency: string
  // Pre-computed delta — null when lastMonth is 0 (avoid divide-by-zero
  // and "+∞%" on the UI).
  deltaPct: number | null
  // 30 daily buckets, oldest → newest, zero-filled. Length always 30.
  sparkline: number[]  // cents per day
  // Footer counts (the secondary stats inside the Pulse card).
  activeProjects: number
  upcomingSessions7d: number
  unresolvedItems: number  // unpaidInvoices + openComments
}
```

The `today` payload shape becomes:

```ts
{
  // existing
  kpis: {...},  // KEEP for backwards compat — TodayView still uses it during the migration window. Removed in Story 6 cleanup.
  items: TodayListItem[],
  savedViews: [...],
  // new
  recentUploads: RecentUpload[],
  pulseStats: PulseStats,
}
```

---

## Component tree

```
apps/web/src/components/dashboard/today/
├── today-view.tsx                  REBUILD — new top-level orchestrator
├── inbox-section.tsx               EXTRACTED from today-view.tsx — reusable
├── recent-uploads-shelf.tsx        NEW (Story 3)
├── recent-upload-card.tsx          NEW (sub-component of shelf)
├── pulse-card.tsx                  NEW (Story 2)
├── pulse-sparkline.tsx             NEW (sub-component of pulse-card)
├── contextual-actions.tsx          NEW (Story 4)
├── kpi-strip.tsx                   DELETE (Story 6)
├── revenue-trend.tsx               MOVED to revenue route (Story 7)
├── share-link-card.tsx             DELETE (Story 6) — share moved to sidebar
└── quick-actions.tsx               DELETE (Story 6)

apps/web/src/components/audio/
└── track-cover.tsx                 NEW (Story 3) — deterministic gradient cover from trackId hash

apps/web/src/components/shell/
└── sidebar.tsx                     EDIT (Story 5) — add share-link chip in footer

apps/web/src/app/(app)/dashboard/
├── page.tsx                        REBUILD (Story 6) — invert hierarchy
└── revenue/
    └── page.tsx                    NEW (Story 7) — host the deep chart
```

---

## Component specs

### `RecentUploadsShelf` (Story 3)

```ts
interface RecentUploadsShelfProps {
  uploads: RecentUpload[]  // up to 7
}
```

**Layout:** horizontal scroll-x row. Section eyebrow `STUDIO · RECENT UPLOADS` + heading. Cards 144×144 cover, title + version label below, project + relative time as subtitle.

**Empty state:** `uploads.length === 0` → component returns `null` (silence > "no tracks yet").

**Sparse state:** 1–4 uploads → render left-aligned, no scroll.

**Full state:** 5+ uploads → render 5 cards visible, sk-scroll-x for the rest, trailing "View all in Music →" link to `/dashboard/music`.

**Card interactions:**
- Click cover → navigates to `/dashboard/projects/${projectId}?tab=music&versionId=${versionId}` (deep-link to that version in the project room)
- Click play overlay (revealed on hover) → fires `skitza:play-version` custom event with `{ versionId, audioUrl, durationMs }` payload — the existing PersistentPlayer subscribes and starts playback. **No new audio infra.**
- Unread comment badge: top-right corner of cover, only when `unreadComments > 0`. Brand-primary fill, white digit. Clicks pass through to the cover (open project room).

**Cover rendering:** `<TrackCover trackId={trackId} size={144} />` — derives a hash from `trackId`, picks 2 colors from a curated 12-entry palette, renders a CSS linear-gradient at a hash-derived angle. Same input → same output (deterministic). No image load, no R2 round-trip.

**Test (Story 3):** rendering test with 0/1/4/7 uploads asserts the right cards + scroll affordance + empty-state.

### `PulseCard` (Story 2)

```ts
interface PulseCardProps {
  stats: PulseStats
}
```

**Layout:**
```
┌──────────────────────────────────────────────────────┐
│ THIS MONTH · PULSE                                   │
│                                                      │
│ ₪ 4,200          ╱╲╱╲___                             │
│ Revenue · April   30d sparkline                      │
│ +12% vs March                                        │
│ ──────────────────────────────────────────────────── │
│ 5 active · 3 sessions · 2 unresolved                 │
└──────────────────────────────────────────────────────┘
```

The sparkline sits **behind** the big number using absolute positioning + low alpha. Clicking the card navigates to `/dashboard/revenue`.

**Empty state:** `thisMonthCents === 0 && lastMonthCents === 0 && sparkline.every(v => v === 0)` → render footer counts only, no sparkline, no delta. Big number reads "—" instead of `$0`.

**`PulseSparkline`** sub-component: SVG inline, 30 points, brand-primary stroke at alpha 0.4, no axis labels (this is ambient, not a deep chart). Uses the same path-tracing approach as `revenue-trend.tsx` so the visual language carries.

### `ContextualActions` (Story 4)

```ts
interface ContextualActionsProps {
  recentUploads: RecentUpload[]
  unresolvedItems: number
  activeProjectsCount: number
  shareUrl: string | null
}
```

**Algorithm — pick up to 3 actions in this priority order:**

1. **Reply to N unresolved** — if `unresolvedItems > 0`. CTA: navigates to inbox with the `unresolved` filter pre-applied (`/dashboard?filter=unresolved`).
2. **Continue with [most-recent-track-title]** — if `recentUploads.length > 0`. CTA: deep-links to that project's music tab.
3. **Send next invoice** — if `activeProjectsCount > 0` AND there's a project in `final_review` state. CTA: navigates to that project's money tab.
4. **Share your link** — fallback, if `shareUrl !== null` and the previous three didn't fire. Opens wa.me share dialog (the polish-pass action, repurposed).
5. **New project** — empty fallback. Routes to `/dashboard/projects/new`.

Render exactly the first 3 that match conditions, in priority order. Pad with the fallbacks if fewer than 3 match.

**Card rendering:** match the polish'd PrimaryButton style (border + bg-elevated + brand inset on hover) — same primitive, refined copy.

### `Today` page rebuild (Story 6)

[`apps/web/src/app/(app)/dashboard/page.tsx`](../../apps/web/src/app/(app)/dashboard/page.tsx) — restructured render tree:

```tsx
<div className="…page-wrapper…">
  <h1 className="sr-only">Today</h1>
  <DashboardGreeting unreadCount={…} />   {/* "Today, Friday April 25 — 2 things need you." */}
  <InboxSection items={data.items} selectedItemId={…} />
  <RecentUploadsShelf uploads={data.recentUploads} />
  <PulseCard stats={data.pulseStats} />
  <ContextualActions …/>
</div>
```

The hero gradient stays. The page max-width stays. The sk-page-enter mount animation stays. Everything below the gradient is new.

**Empty state for day-1 producers** (no projects, no invoices, no uploads): replace the entire stack with a single `<DashboardEmptyOnboarding />` card centered with breathing space — "Your first booking is one share away. Drop your link, see what happens." + the share URL chip + a copy button. No QuickActions, no zeros.

Empty-state predicate: `data.recentUploads.length === 0 && data.pulseStats.activeProjects === 0 && data.items.length === 0`.

### `SidebarShareChip` (Story 5)

[`apps/web/src/components/shell/sidebar.tsx`](../../apps/web/src/components/shell/sidebar.tsx) footer — replace the existing `Public profile →` link with a compact inline share chip:

```
┌─────────────────────┐
│ skitza.app/         │  [📋 copy]   ← always visible, every authenticated page
│ join/gili-asraf     │
└─────────────────────┘
```

When `producerSlug === null`: chip becomes "Set your slug →" linking to `/dashboard/settings?section=profile`. Same affordance as the original missing-slug state on Today.

When sidebar is collapsed: chip collapses to a single 📋 icon-button that copies on click. Tooltip = the URL.

### Revenue route (Story 7)

[`apps/web/src/app/(app)/dashboard/revenue/page.tsx`](../../apps/web/src/app/(app)/dashboard/revenue/page.tsx) — new server component. Calls `caller.producer.revenueTrend()` (existing tRPC query, unchanged) and renders `<RevenueTrend>` at full breathable size (~600×400 — vertical), with a heading + eyebrow.

For v1, no toggles, no MoM/YoY, no export. Just the chart it the size it deserves.

---

## Test strategy

### Backend (Story 1)

- **`producer.today` integration test** in `apps/web/src/server/trpc/routers/__tests__/today-recent-uploads.test.ts`:
  - assert `recentUploads` is scoped to the caller's producer (use `findPredicate` walker on the WHERE clause)
  - assert ordering: latest `uploadedAt` first
  - assert filter: archived + cancelled projects' tracks are excluded
  - assert filter: `audioUrl IS NULL` (in-flight uploads) excluded
  - assert `unreadComments` count: only `fromProducer=false`, `resolvedAt IS NULL`, `createdAt > uploadedAt`
  - assert limit: 7 rows max even with 100 fixture versions

- **`producer.today` `pulseStats` test** in same file:
  - assert delta math: `(this - last) / last * 100`, rounded to integer
  - assert `deltaPct === null` when `lastMonth === 0`
  - assert sparkline length: always 30
  - assert sparkline zero-fill: missing days are `0`, not skipped

### Components (Stories 2–5)

- **`pulse-card.test.tsx`** — empty state (zeros), populated state, delta sign
- **`recent-uploads-shelf.test.tsx`** — 0/1/4/7 uploads, hover-play event fired, badge for unread comments
- **`contextual-actions.test.tsx`** — priority algorithm with 5+ producer states (zero data / unresolved-only / recent-upload-only / final-review-only / fallback)
- **`sidebar-share-chip.test.tsx`** — copy on click, "Set your slug" fallback when slug missing, collapsed-state icon-only

### Page (Story 6)

- **`today-redesign.test.tsx`** — mock data fixtures for "day-1 producer" (empty) and "active producer" (5 uploads, 2 unresolved, ₪4200 this month) — assert correct sections render in correct order

---

## Migration / rollback

- The redesign is feature-flag-free. Land the PR, the new layout is live.
- Rollback = revert the merge commit. The existing components stay until Story 6's deletion sweep, so no orphaned imports during the staged dev rollout.
- The new `producer.today` payload shape is **additive** — existing TodayView still gets `kpis` and `items` unchanged. The cleanup that removes `kpis` happens in Story 6, after the new components are wired.

---

## Out of scope (deferred to future passes)

- Waveform-image cover art (use deterministic gradient covers in v1)
- Persistent player redesign
- Revenue page deep features (drill-down, MoM/YoY toggles, export)
- Sidebar redesign beyond the share-chip footer
- Optimistic updates on the inbox (still uses the existing tRPC fetch pattern)
- `recent-uploads` polling / live updates — initial v1 fetches at page load only
