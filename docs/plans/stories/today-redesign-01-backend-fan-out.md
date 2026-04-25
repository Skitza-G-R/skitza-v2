# Story 01 — Backend fan-out: extend `producer.today` with `recentUploads` + `pulseStats`

**Epic:** Today redesign 2026-04-25
**Architecture ref:** [`docs/plans/active/2026-04-25-today-redesign-architecture.md` § Data layer](../active/2026-04-25-today-redesign-architecture.md)
**Depends on:** none — this is the foundation story.
**Blocks:** Stories 2 (PulseCard), 3 (RecentUploadsShelf), 4 (ContextualActions), 6 (page rebuild).
**Subagent:** `skitza-tdd-implementer`

## Goal

Add two new fan-out legs to the existing `producer.today` tRPC procedure so the redesigned Today screen can fetch all data in one round-trip. No DB migration — uses existing schema columns only.

## User story

As a producer, when I open Today, I want all the data needed for the redesigned dashboard (inbox + recent uploads + pulse stats) to load in a single round-trip so the page renders without staggered loading states.

## Acceptance criteria

- [ ] `producer.today` returns the existing `kpis`, `items`, `savedViews` payload **unchanged** (backwards compat — TodayView still uses `kpis` until Story 6 cleans up).
- [ ] Adds `recentUploads: RecentUpload[]` (length ≤ 7).
- [ ] Adds `pulseStats: PulseStats` (always present, with zero-filled defaults when there's no data).
- [ ] All new queries are scoped by `producerId` in their `WHERE` clause (assert via `findPredicate` in tests).
- [ ] `recentUploads` excludes:
  - track versions where `audioUrl IS NULL` (still uploading)
  - track versions on projects where `stage IN ('archived', 'cancelled')`
- [ ] `recentUploads` is ordered by `uploadedAt DESC`.
- [ ] Each `recentUploads` row includes `unreadComments` — count of `trackComments` matching: `versionId = row.versionId`, `fromProducer = false`, `resolvedAt IS NULL`, `createdAt >= row.uploadedAt`.
- [ ] `pulseStats.deltaPct` is `null` when `lastMonthCents === 0` (avoid divide-by-zero / `+∞%`).
- [ ] `pulseStats.sparkline` is always length 30, oldest → newest, zero-filled for days with no paid invoices.
- [ ] `pulseStats` footer counts (`activeProjects`, `upcomingSessions7d`, `unresolvedItems`) match the existing `kpis` for the same data — they're derived from the same fan-out legs.
- [ ] `/skitza-verify` passes.

## Technical context

### Schema (already exists — do NOT migrate)

[`packages/db/src/schema.ts`](../../packages/db/src/schema.ts):
- `projects.producerId` — tenant scope
- `projects.stage` — `pgEnum`; active stages = `["lead", "booked", "contract_sent", "in_production", "final_review"]` (already declared as `ACTIVE_STAGES` constant inside `producer.today`)
- `projectTracks` (id, projectId, title, …)
- `trackVersions` (id, trackId, label, audioUrl, durationMs, uploadedAt, …)
- `trackComments` (versionId, fromProducer, resolvedAt, createdAt)
- `invoices` — already used by leg 2 of the existing fan-out

### File to edit

[`apps/web/src/server/trpc/routers/producer.ts`](../../apps/web/src/server/trpc/routers/producer.ts) — the `today` procedure starts at line 225.

### Output type additions

```ts
// Add to the procedure's inferred return type via the .query callback.
type RecentUpload = {
  versionId: string
  trackId: string
  title: string
  versionLabel: string
  uploadedAt: Date
  audioUrl: string                  // never null after WHERE filter
  durationMs: number | null
  projectId: string
  projectClientName: string
  projectStage: ProjectStage
  unreadComments: number
}

type PulseStats = {
  thisMonthCents: number
  lastMonthCents: number
  currency: string
  deltaPct: number | null           // null when last month was 0
  sparkline: number[]               // length === 30
  activeProjects: number
  upcomingSessions7d: number
  unresolvedItems: number
}
```

### Implementation hints

- `recentUploads` join: `trackVersions ⨝ projectTracks ⨝ projects WHERE producerId = ? AND stage IN active AND audioUrl IS NOT NULL ORDER BY uploadedAt DESC LIMIT 7`. Same pattern as leg 5 of the existing fan-out (joins through `projectTracks → projects` for tenant scoping).
- `unreadComments` is a follow-up after the main rows return. Use `Promise.all(rows.map(...))` for the 7 sub-queries. Tail latency is acceptable here — under 7 round-trips.
- `pulseStats.sparkline`: query daily-bucket aggregates, then JS-side normalize to a length-30 array. Index 0 = 30 days ago; index 29 = today. Use the producer's UTC day boundaries to match how leg 2 buckets month boundaries.
- `pulseStats.deltaPct` formula: `Math.round((thisMonth - lastMonth) / lastMonth * 100)`. If `lastMonth === 0`, return `null`.
- `pulseStats.currency`: use the producer's `defaultCurrency` (already fetched as part of `profileRows` in the existing fan-out).
- `pulseStats.activeProjects`/`upcomingSessions7d`/`unresolvedItems` reuse the **already-fetched rows** from legs 1, 4, 3+5 — don't re-query.

## TDD steps

1. **RED** — add `apps/web/src/server/trpc/routers/__tests__/today-recent-uploads.test.ts`. Mock the DB with marker objects (per CLAUDE.md mock-DB pattern). Assert: `result.recentUploads` is defined, has length ≤ 7, ordered by `uploadedAt` desc, excludes archived/cancelled projects' tracks. Run — fails because `recentUploads` field doesn't exist on the return type yet.
2. **GREEN** — extend the `Promise.all` fan-out with the recent-uploads query + the unread-comments sub-queries. Build the `RecentUpload[]` array. Add to the return object. Tests go green.
3. **RED** — add `today-pulse-stats.test.ts`. Assert: `result.pulseStats.deltaPct === null` when last-month rows are empty; `result.pulseStats.sparkline.length === 30`; `result.pulseStats.activeProjects` matches `result.kpis.activeProjects`. Run — fails because `pulseStats` doesn't exist.
4. **GREEN** — add the last-month query + sparkline aggregate query. Build `PulseStats`. Add to return. Tests go green.
5. **RED + GREEN** — auth-scoping assertions. For each new query, assert via `findPredicate` that `WHERE producerId = ctx.producerId` is present. Add the predicate if missing.
6. `/skitza-verify` — typecheck + lint + 700+ tests should all pass.

## Test file paths

- `apps/web/src/server/trpc/routers/__tests__/today-recent-uploads.test.ts`
- `apps/web/src/server/trpc/routers/__tests__/today-pulse-stats.test.ts`

Both use the established marker-mock pattern with `findPredicate` for auth-scope assertions. See [`artist-home.test.ts`](../../apps/web/src/server/trpc/routers/__tests__/artist-home.test.ts) for the canonical example.

## Commit message

```
feat(today): backend fan-out for redesign — recentUploads + pulseStats

Adds two new legs to producer.today's Promise.all so the redesigned
Today dashboard (Story 6) can render all sections in a single
round-trip. No DB migrations — both legs use existing columns only.

recentUploads: last 7 track versions across active projects, ordered
by uploadedAt desc, with unreadComments count (artist-side, unresolved,
posted after the version uploaded). Joins through project_tracks →
projects for tenant scoping. WHERE producer_id = ctx.producerId on
every join.

pulseStats: thisMonthCents + lastMonthCents + deltaPct (null when
lastMonth is 0 — no +∞% rendering) + 30-day daily sparkline (always
length 30, zero-filled for missing days) + activeProjects /
upcomingSessions7d / unresolvedItems re-projected from existing
fan-out legs (no new round-trips for the footer counts).

Existing kpis/items/savedViews fields unchanged. TodayView keeps
working until Story 6 cleans up.

Story 01 of the today-redesign epic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
