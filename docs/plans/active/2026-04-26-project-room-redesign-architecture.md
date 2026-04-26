# Project Room Redesign — Architecture

> **PRD anchor:** §4.2 sub-tab list · §11.5 Project Dashboard tab · §11.6 Music tab redesign · §11.7 Performance contract
> **Track:** BMAD Large
> **Branch:** `feat/project-room-redesign`
> **Date:** 2026-04-26
> **Author:** Claude (Architect role)

This document is the technical contract between the PM phase (PRD §11.5–§11.7) and the Dev phase (story-level subagents). It cites real schema types and file paths — no invention. Dev subagents implementing each story should read this end-to-end before touching code.

---

## 1. Overview

The Project Room (`/dashboard/projects/[id]`) is being rewritten to:

1. **Replace** the Notes tab with a new **Dashboard** tab that becomes the default sub-tab.
2. **Redesign** the Music tab around drop-first uploads, Frame.io-style version stacking, range comments, and Replay-style cross-version unresolved-comment persistence.
3. **Fix** sub-tab switching so it's `< 150ms` perceived latency (currently ~5s due to React remount + re-fetch of all data).
4. **Diagnose & fix** R2 upload "Failed to fetch" — every project, every upload.

Locked PRD trade-offs (do not revisit at the Dev layer): stems remain zip-on-finished-version (§11.4 unchanged), voice memos deferred to v2, range comments + cross-version unresolved both ship in v1.

---

## 2. Schema changes

### 2.1 Migration `0035_track_comments_range_and_dashboard.sql`

Single migration. Idempotent. `BEGIN; … COMMIT;` wrapped. Applied via `/skitza-migrate` (the journal is broken past 0028 — see CLAUDE.md). Do NOT touch `_journal.json`.

```sql
BEGIN;

-- Range comments: nullable end-time. NULL = point comment (existing semantics).
-- Non-NULL = range comment spanning timestamp_ms → end_timestamp_ms.
ALTER TABLE track_comments
  ADD COLUMN IF NOT EXISTS end_timestamp_ms INTEGER;

-- Index supporting the cross-version unresolved query:
-- "give me unresolved comments for track X across all versions, newest first."
-- Joined query traverses track_comments.version_id → track_versions.track_id.
-- The index on (version_id, resolved_at) lets the join + filter run with
-- a single index scan instead of a heap scan over track_comments.
CREATE INDEX IF NOT EXISTS track_comments_version_unresolved_idx
  ON track_comments (version_id, resolved_at);

COMMIT;
```

That's it. **No** new tables. **No** changes to `projects.notes` (we keep the underlying scratchpad column even though no UI reads it — restoring the Notes tab later is a UI-only change, no migration cost).

### 2.2 Schema types touched

- [`packages/db/src/schema.ts:447`](packages/db/src/schema.ts) — `trackComments` table: add `endTimestampMs: integer("end_timestamp_ms")` (nullable, no `.notNull()`).
- Type `TrackComment` and `NewTrackComment` (lines 460-461) auto-update from the inferred type.

### 2.3 Validation

After applying migration, run:

```bash
psql "$DATABASE_URL" -c "\\d track_comments" | grep -E "(end_timestamp_ms|track_comments_version_unresolved_idx)"
```

Expected: 2 lines printed. If 0 or 1, the migration didn't apply — re-run `/skitza-migrate` and inspect output.

---

## 3. Auth & data scoping

All new procedures use **`producerProcedure`** (Clerk session + producer row required) on the producer side. The artist-side reads (Dashboard tab when an artist views their own project) reuse existing **`artistProcedure`** — but for the v1 redesign, **only the producer-side Dashboard tab is in scope.** Artist-side Dashboard rendering ships as a follow-up story (see §9 risks).

Every new procedure must scope by `ctx.producerId` in the WHERE clause. Tests assert this via `findPredicate` — see §7.

---

## 4. tRPC procedure split

Today's project page calls one fat aggregation that fetches everything for all 4 tabs in one server round-trip (the partial code map showed: project detail, money, contracts, bookings, client contacts, Stripe payment methods — sequential with try/catches). We split it into 4 per-tab queries plus a tiny page-shell query.

### 4.1 New router file

[`apps/web/src/server/trpc/routers/project-room.ts`](apps/web/src/server/trpc/routers/project-room.ts) — new file. Existing project-related procedures stay in [`apps/web/src/server/trpc/routers/project.ts`](apps/web/src/server/trpc/routers/project.ts) and are gradually migrated; the new file is for the per-tab queries. Mount under `appRouter.projectRoom` in [`apps/web/src/server/trpc/_app.ts`](apps/web/src/server/trpc/_app.ts).

### 4.2 Procedure shapes

```ts
// All take { projectId: string (uuid) } as input.
const projectIdInput = z.object({ projectId: z.string().uuid() });

projectRoom.shell
  // Page-shell data: title, artistName, artistAvatarUrl, stage, paymentStatus,
  // tagPills. The minimum to render the header strip + tab bar before any
  // tab data lands. ~10 columns. No fan-out.
  : producerProcedure.input(projectIdInput).query()

projectRoom.dashboard
  // Aggregated for §11.5 Dashboard tab. Returns:
  //   { latestVersion: { trackId, trackTitle, versionLabel, audioUrl,
  //                      sentAt, statusEnum } | null,
  //     whatsNext: { kind, payload } | null,  // see §11.5 precedence list
  //     recentActivity: ActivityEvent[],       // last 10, client trims to 5
  //     openComments: { trackId, trackTitle, timestampMs,
  //                     endTimestampMs, body, replyCount }[],  // top 3
  //     sidebar: { stage, agreedAmount, paidAmount, outstandingAmount,
  //                nextSession, fileCount, fileTotalBytes,
  //                artist: { name, avatarUrl, email } } }
  : producerProcedure.input(projectIdInput).query()

projectRoom.music
  // Tracks + versions + comments for §11.6. Returns:
  //   { tracks: { id, title, artistTag, createdAt,
  //               versions: { id, label, audioUrl, audioReady,
  //                           statusEnum, createdAt }[],
  //               unresolvedComments: TrackCommentWithVersionLabel[] }[] }
  // unresolvedComments is the cross-version persistence payload — joined via
  // track_comments.version_id → track_versions.track_id, filtered by
  // track_comments.resolved_at IS NULL, sorted by created_at DESC.
  : producerProcedure.input(projectIdInput).query()

projectRoom.sessions
  // Today's session-tab data, untouched in scope but moved to the new file
  // for symmetry. Returns: { bookings: Booking[] }
  : producerProcedure.input(projectIdInput).query()

projectRoom.money
  // Today's money-tab data. Returns: { paid, outstanding, next, invoices,
  //                                     contractSummary, stripePaymentMethods }
  : producerProcedure.input(projectIdInput).query()
```

The fat `project.byId` aggregation is **deprecated, not deleted** — keep it for one release so existing in-flight features don't break. Add a `// @deprecated — split into projectRoom.* in PR #<N>` comment + grep for callers; the only caller should be the [page.tsx](apps/web/src/app/(app)/dashboard/projects/[id]/page.tsx). Once that page migrates, remove `project.byId`.

### 4.3 New mutations (Music tab)

```ts
projectRoom.createTrackFromUpload
  // Replaces the title-first form. Input: { projectId, filename, fileSize }.
  // Server derives title from filename (strip suffixes), creates Track row +
  // Version V1 row with audio_ready=false + audio_url=null, returns
  // { trackId, versionId, presignedMultipartInit }. Client then uses the
  // existing useMultipartUpload hook to PUT parts to R2 + completes via
  // existing audio.completeMultipart action.

projectRoom.addVersionFromUpload
  // Drop-on-row → new version of existing track. Same as above but skips
  // Track creation, takes { trackId, filename, fileSize }, returns
  // { versionId, presignedMultipartInit }.

projectRoom.setVersionStatus
  // Bilateral status flip. Input: { versionId, status: 'draft'|'revisit'|'final' }.
  // status enum stored as DB enum (new) or text (looser); see §2.1 if we add
  // an enum — for v1 we use TEXT with a CHECK constraint to avoid an enum
  // migration. UI maps to artist verbs at render time:
  //   'draft' → producer "Draft" / artist "In progress"
  //   'revisit' → producer "Revisit" / artist "Needs work"
  //   'final' → producer "Final" / artist "Approved"

projectRoom.addRangeComment
  // New mutation for range comments (point comments still use existing
  // procedure). Input: { versionId, body, timestampMs, endTimestampMs }.
  // Validates endTimestampMs > timestampMs; clamps both to >= 0.

projectRoom.resolveComment
projectRoom.unresolveComment
  // Toggle resolved_at on a comment. Both producer & artist allowed
  // (subject to identity check on the version's project tenancy).
```

**Note on version status TEXT vs ENUM:** stick with TEXT + CHECK for v1 — adding a Postgres enum requires `CREATE TYPE` which is irreversible without a follow-up `DROP TYPE`. TEXT is forward-compatible. Migration `0035` adds:

```sql
ALTER TABLE track_versions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft', 'revisit', 'final'));
```

Existing rows get `'draft'` via `DEFAULT`.

---

## 5. Component tree

### 5.1 New components

| Path | What |
|---|---|
| [`apps/web/src/components/dashboard/project/sub-tabs/dashboard-sub-tab.tsx`](apps/web/src/components/dashboard/project/sub-tabs/dashboard-sub-tab.tsx) | The §11.5 Dashboard tab — focal column + meta sidebar layout |
| [`apps/web/src/components/dashboard/project/dashboard/header-strip.tsx`](apps/web/src/components/dashboard/project/dashboard/header-strip.tsx) | Header with stage chip + morphing CTA |
| [`apps/web/src/components/dashboard/project/dashboard/latest-version-strip.tsx`](apps/web/src/components/dashboard/project/dashboard/latest-version-strip.tsx) | Embedded waveform + play button (reuses `PersistentPlayer`) |
| [`apps/web/src/components/dashboard/project/dashboard/whats-next.tsx`](apps/web/src/components/dashboard/project/dashboard/whats-next.tsx) | One-line next-action — pure render of server-derived signal |
| [`apps/web/src/components/dashboard/project/dashboard/recent-activity-feed.tsx`](apps/web/src/components/dashboard/project/dashboard/recent-activity-feed.tsx) | Linear-style collapsed history |
| [`apps/web/src/components/dashboard/project/dashboard/open-comments-list.tsx`](apps/web/src/components/dashboard/project/dashboard/open-comments-list.tsx) | Top 2-3 unresolved threads, click-jump to Music tab |
| [`apps/web/src/components/dashboard/project/dashboard/meta-sidebar.tsx`](apps/web/src/components/dashboard/project/dashboard/meta-sidebar.tsx) | Right rail / mobile chip strip |
| [`apps/web/src/components/dashboard/project/sub-tabs/music/track-row.tsx`](apps/web/src/components/dashboard/project/sub-tabs/music/track-row.tsx) | Per-track row with version chips + status pill + comments |
| [`apps/web/src/components/dashboard/project/sub-tabs/music/drop-zone.tsx`](apps/web/src/components/dashboard/project/sub-tabs/music/drop-zone.tsx) | The empty-state and pinned-top drop zone — reuses `useMultipartUpload` |
| [`apps/web/src/components/dashboard/project/sub-tabs/music/range-comment-overlay.tsx`](apps/web/src/components/dashboard/project/sub-tabs/music/range-comment-overlay.tsx) | Drag-on-waveform → range selection → comment composer |
| [`apps/web/src/components/dashboard/project/sub-tabs/music/version-status-pill.tsx`](apps/web/src/components/dashboard/project/sub-tabs/music/version-status-pill.tsx) | Bilateral status dropdown (different copy by viewer role) |

### 5.2 Modified components

| Path | Change |
|---|---|
| [`apps/web/src/app/(app)/dashboard/projects/[id]/page.tsx`](apps/web/src/app/(app)/dashboard/projects/[id]/page.tsx) | Trim server fetch to `projectRoom.shell` only. Render `<ProjectRoomClient>` with `initialTab` from URL. Per-tab data fetched client-side via tRPC hooks. |
| [`apps/web/src/components/dashboard/project/project-sub-tabs.tsx`](apps/web/src/components/dashboard/project/project-sub-tabs.tsx) | (a) 4 tabs, default Dashboard. (b) `<Link>` → `<button>` with `router.replace(href, { scroll: false })`. (c) **No `key={activeTab}` on the panel.** All panels mounted; inactive ones get `display: none` via `aria-hidden + className`. (d) Reveal-up animation fires once per panel, not per tab change — use `data-mounted` flag. |
| [`apps/web/src/components/dashboard/project/project-sub-tab-shared.ts`](apps/web/src/components/dashboard/project/project-sub-tab-shared.ts) | Update `ProjectSubTab` union: `'music' \| 'sessions' \| 'money' \| 'notes'` → `'dashboard' \| 'music' \| 'sessions' \| 'money'`. Update `isProjectSubTabId`. Update default in `resolveSubTab` to `'dashboard'`. **This file MUST stay free of `"use client"` — see CLAUDE.md mistake log 2026-04-23.** |
| [`apps/web/src/components/dashboard/project/sub-tabs/music-sub-tab.tsx`](apps/web/src/components/dashboard/project/sub-tabs/music-sub-tab.tsx) | Full rewrite. Drop the title-first add-track form (lines ~455-523). Replace the version-creation form (lines ~341-377) with drop-on-row gesture. Render `<TrackRow>` per track (extracted). |
| [`apps/web/src/components/dashboard/project/sub-tabs/notes-sub-tab.tsx`](apps/web/src/components/dashboard/project/sub-tabs/notes-sub-tab.tsx) | **Delete.** No imports remain after `project-sub-tabs.tsx` is updated. Confirm via grep before deleting. |

### 5.3 Audio + upload reuse

The upload pipeline does NOT change:

- Multipart presigned URL minting: existing `audio.signPart` Server Action + `audio.completeMultipart` action.
- Client hook: existing [`apps/web/src/components/audio/use-multipart-upload.ts`](apps/web/src/components/audio/use-multipart-upload.ts) (computes 5MB parts, fetches signed URLs, PUTs, collects ETags, calls completeMultipart).
- Persistent player: existing [`PersistentPlayer`](apps/web/src/components/audio/persistent-player.tsx) reused for Dashboard latest-version strip.

What changes is **what triggers the upload**:
- Was: title-first form submit → server action creates track row → AudioUploader renders → upload starts
- Now: file dropped → `projectRoom.createTrackFromUpload` mutation creates Track + V1 rows + returns presignedMultipartInit → upload starts immediately

The new mutations are thin wrappers around existing logic — no new R2 code.

---

## 6. R2 upload bug — diagnosis & fix

User report: "Failed to fetch (skitza-audio.<bucket>.r2.cloudflarestorage.com)" on every project, every upload, "worked once a long time ago." This is a CORS-shaped failure (browser preflight rejection); the server-side presigned URL generation is fine (Vercel logs show 200 on `audio.signPart`).

### 6.1 Verify CORS config in code is correct (already done by Architect)

[`apps/web/src/server/storage/r2-cors.ts`](apps/web/src/server/storage/r2-cors.ts) defines the desired policy. Per partial code map: `AllowedOrigins` includes prod + Vercel preview + `localhost:3000`; `AllowedMethods: PUT, GET, HEAD`; `AllowedHeaders: ["*"]`; `ExposeHeaders: ["ETag"]`. Looks correct.

### 6.2 Verify CORS is APPLIED to the live bucket

This is the suspect step. The bucket might never have had the policy applied, or the bucket was recreated post-application.

**Verification command** (run from a logged-in Cloudflare R2 context, or just curl the bucket):

```bash
# Replace <bucket-host> with the real R2 endpoint from skitza-audio config.
curl -i -X OPTIONS \
  "https://<bucket-host>" \
  -H "Origin: https://skitza.app" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type"
```

**Expected if CORS is applied:**
- HTTP 200
- `Access-Control-Allow-Origin: https://skitza.app`
- `Access-Control-Allow-Methods: PUT, GET, HEAD`
- `Access-Control-Expose-Headers: ETag`

**Expected if CORS is NOT applied:**
- HTTP 403 / 405 OR missing `Access-Control-Allow-Origin` header

### 6.3 Apply CORS if missing

```bash
node apps/web/scripts/apply-r2-cors.mjs
```

The script is idempotent (`PutBucketCorsCommand` replaces prior policy). Re-run is safe. Output should end with success — capture and paste in story comment.

### 6.4 If CORS is correct but upload still fails

Less likely, but the next layers to check:

1. **Presigned URL signature mismatch** — clock skew between Vercel and R2; check the `Date:` header on the request vs server time. Run `audio.signPart` with `console.log` of the URL inputs; verify the Authorization header carries a recent timestamp.
2. **Multipart UploadId expired** — uploads must finalize within 1 hour by default. The retry path in `useMultipartUpload` may be reusing a stale UploadId. Add expiry check.
3. **ETag header missing in response** — `ExposeHeaders: ["ETag"]` is required. Without it, the browser hides ETag from JS even though the response succeeded, and `completeMultipart` can't reconstruct the part manifest. Verify `Access-Control-Expose-Headers: ETag` is in the OPTIONS response.

### 6.5 Story commitment

The R2 fix is **Story 6** (last story). It's the smallest story (likely 1 commit, a script-run + a verification test) but it's the one the user most cares about for the immediate "uploads work again" win. Order rationale: do it last so we can build the new Music UI confidently knowing uploads will work end-to-end after the final story lands. Alternative: do it first as a hotfix on `main` and merge that PR before the redesign — see §9 risks.

---

## 7. Performance fix

The 5-second sub-tab switch is caused by **three stacking issues**:

1. **`<Link>` for tab switch** in `project-sub-tabs.tsx` triggers a Next.js navigation, which re-runs the server page, which re-fetches `project.byId` (the fat aggregation).
2. **`key={activeTab}` on the panel div** forces React to unmount + remount the entire subtree on every tab change. Animation replays from zero.
3. **No per-tab data caching** — every visit re-runs the full aggregation.

### 7.1 Three changes

**(a) Tab change — shallow client-side routing.**

```tsx
// In project-sub-tabs.tsx
import { useRouter, useSearchParams } from "next/navigation";

const router = useRouter();
const params = useSearchParams();
const activeTab = (params.get("tab") ?? "dashboard") as ProjectSubTab;

const onTabClick = (next: ProjectSubTab) => {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", next);
  // Shallow: updates URL without re-running the server page.
  router.replace(url.pathname + url.search, { scroll: false });
};
```

`router.replace` in App Router with `scroll: false` does NOT trigger a server-side render of the page — the tab change is purely a URL update + a re-render of any component that reads the search param.

**(b) No remount.**

```tsx
// All four panels mounted at all times. Inactive ones hidden via CSS.
<div role="tabpanel" data-active={activeTab === 'dashboard'} className="...">
  <DashboardSubTab projectId={projectId} />
</div>
<div role="tabpanel" data-active={activeTab === 'music'} className="...">
  <MusicSubTab projectId={projectId} />
</div>
// ... etc
```

CSS:

```css
[role="tabpanel"][data-active="false"] {
  display: none;
}
```

`display: none` doesn't unmount — React state, scroll position, in-progress uploads, and audio playback all survive. (Compared to `visibility: hidden` which keeps the layout space.) The reveal-up animation runs once per panel on first paint; subsequent shows are instant.

**(c) Per-tab tRPC queries cached.**

Each panel runs its own `trpc.projectRoom.<tab>.useQuery({ projectId })`. tRPC + React Query default `staleTime` is `0` — set `staleTime: 30_000` on these queries so a tab switch within 30s doesn't re-fetch. On first page mount, kick off all 4 in parallel via `useQueries`; React Query dedupes:

```tsx
useQueries({
  queries: [
    trpc.projectRoom.dashboard.useQuery.query({ projectId }, { staleTime: 30_000 }),
    trpc.projectRoom.music.useQuery.query({ projectId }, { staleTime: 30_000 }),
    trpc.projectRoom.sessions.useQuery.query({ projectId }, { staleTime: 30_000 }),
    trpc.projectRoom.money.useQuery.query({ projectId }, { staleTime: 30_000 }),
  ],
});
```

(Pseudocode — actual tRPC `useQueries` hook syntax.)

### 7.2 Perf probe

Add a dev-only client probe in `project-sub-tabs.tsx`:

```tsx
useEffect(() => {
  if (process.env.NODE_ENV !== "development") return;
  const t0 = performance.now();
  // Wait for next paint.
  requestAnimationFrame(() => {
    const dt = performance.now() - t0;
    if (dt > 150) console.warn(`[perf] tab switch ${activeTab} took ${dt}ms`);
  });
}, [activeTab]);
```

QA story acceptance criterion: switch each pairing 10 times in a row, every measurement < 150ms.

---

## 8. Test strategy

### 8.1 Per-procedure (mock-DB pattern from CLAUDE.md)

Each new tRPC procedure gets a test in `apps/web/src/server/trpc/routers/__tests__/project-room.<name>.test.ts`:

- **Auth-scoping assertion**: `findPredicate(where, projectsMarker, "producerId", ctx.producerId)` returns `true`. Catches tenant-leak regressions.
- **Shape assertion**: returned object matches the documented type.
- **Edge cases**: project not found → `NOT_FOUND`; project belongs to different producer → `NOT_FOUND` (not `FORBIDDEN`, to avoid enumeration).

### 8.2 Schema migration test

`packages/db/src/__tests__/0035-track-comments-range.test.ts` — integration test against `DATABASE_URL_TEST`:

1. Insert a track + version + comment with `endTimestampMs = NULL`. Read it back. Assert null preserved.
2. Insert a comment with `endTimestampMs = 90000`. Read back. Assert value preserved.
3. Validate the index exists via `pg_indexes` query.

### 8.3 Component tests (Vitest + RTL)

Per-component tests next to each new component:

- `dashboard-sub-tab.test.tsx`: empty-state render (zero versions) → "Your project hasn't started yet" placeholder; populated render → all 5 modules render once each.
- `track-row.test.tsx`: drop-target hover state shows two halves; drop on top half → `addVersionFromUpload` called; drop on bottom half → `createTrackFromUpload` called.
- `range-comment-overlay.test.tsx`: drag from `t=10000` to `t=20000` → composer opens with `[10s, 20s]` chip; submit → `addRangeComment` called with `endTimestampMs: 20000`.
- `version-status-pill.test.tsx`: producer viewer shows "Draft / Revisit / Final"; artist viewer shows "In progress / Needs work / Approved"; same DB enum value renders both.
- `project-sub-tabs.test.tsx`: 4 tabs render; click "Music" → URL updates to `?tab=music` without page navigation; switching back to Dashboard preserves Music's scroll position (assertion via `data-active` attribute alone — DOM presence is enough proof).

### 8.4 Cross-version unresolved query test

`apps/web/src/server/trpc/routers/__tests__/project-room.music-cross-version.test.ts`:

1. Set up a track with V1 + V2.
2. Insert one resolved comment on V1 (`resolved_at = NOW()`).
3. Insert one unresolved comment on V1 (`resolved_at = NULL`).
4. Insert one unresolved comment on V2.
5. Call `projectRoom.music({ projectId })`.
6. Assert that for the track:
   - `unresolvedComments.length === 2`
   - Both unresolved comments are present, the V1 one tagged `(from V1)` in the rendered UI label.
   - The resolved V1 comment is NOT in `unresolvedComments`.

### 8.5 Motion-primitives invariant

The existing test at [`apps/web/src/app/__tests__/motion-primitives.test.ts`](apps/web/src/app/__tests__/motion-primitives.test.ts) MUST keep passing — any new animation primitives in the redesign need a `@media (prefers-reduced-motion: reduce)` gate. (Per CLAUDE.md UI conventions.)

---

## 9. Story breakdown (preview for SM phase)

The Scrum Master phase will write self-contained story files at `docs/plans/stories/project-room-NN-<title>.md`. Preview ordering:

| # | Title | Why this order | Story file |
|---|---|---|---|
| **S01** | Schema migration (`0035`) + status TEXT column | Everything depends on these schema changes. Land first. Tiny PR. | `project-room-01-schema-migration.md` |
| **S02** | tRPC procedure split (5 new queries + 5 new mutations) | All UI depends on these. Build server before client. Tests pin auth-scoping. | `project-room-02-trpc-split.md` |
| **S03** | Sub-tab refactor: 4 tabs, no remount, shallow routing, perf probe | Fixes the 5s switch issue. Independent of new tab content. Demos a real win immediately. | `project-room-03-subtab-perf.md` |
| **S04** | Dashboard tab UI (all 5 modules + meta sidebar) | The big new tab. Builds on S02's `projectRoom.dashboard`. | `project-room-04-dashboard-tab.md` |
| **S05** | Music tab — drop-first + drop-on-row + version stacking + status pill | The primary fix for the user's UX complaint. Builds on S02 mutations. | `project-room-05-music-redesign.md` |
| **S06** | Music tab — range comments + cross-version unresolved | Smaller follow-up to S05 — depends on S01's schema + S02's `addRangeComment`. | `project-room-06-music-comments.md` |
| **S07** | R2 CORS verify-and-fix + smoke test | Last because it's a 1-commit infra fix; doing it last ensures the whole new UI is tested end-to-end with working uploads. | `project-room-07-r2-cors-fix.md` |

**Alternative**: extract S07 into a hotfix that merges to `main` immediately, before the redesign branch lands. See §10 risks.

---

## 10. Risks & rollout

### 10.1 R2 fix should probably ship as a hotfix

The user is hitting upload failures TODAY. Bundling the R2 fix into a PR that also has 6 other stories means the user can't upload anything for the days/weeks the redesign takes. Recommendation: split S07 into its own branch off `main`, ship within an hour of starting it, merge, then `git rebase main` the redesign branch. This is a 1-line plan deviation and greatly improves the user experience.

**Decision needed:** ask the user at SM-phase boundary — "split R2 fix as a hotfix?" Default YES.

### 10.2 Parallel-session collision

CLAUDE.md mistake log entry now warranted (add as new entry): *"2026-04-26: Discovered a long-running parallel Claude session was committing to `feat/today-redesign` while another conversation was editing the same repo. Working tree edits got wiped twice via the parallel session's `git reset --hard`. Fix: switch to a git worktree (`git worktree add ../skitza-project-room <branch>`) so each session has an isolated working tree but shares the git db. Stash + branch was insufficient — the other session's resets ran on the shared working tree."*

The redesign work proceeds in `../skitza-project-room`. When the redesign is ready to merge, the worktree is removed (`git worktree remove ../skitza-project-room`) — the branch persists in the shared `.git` and merges normally.

### 10.3 Status enum: TEXT vs PG ENUM

I chose TEXT + CHECK for forward-compat. If the product later wants to add a 4th status (`'archived'`?), TEXT is `ALTER COLUMN ... CHECK (status IN (...))` — straightforward. PG enum requires `ALTER TYPE ... ADD VALUE ...` which can only be run outside transactions and is hard to undo. TEXT wins.

### 10.4 Audio playback continuity across tab switches

The `display: none` hide approach preserves audio elements, but Web Audio APIs sometimes pause on `display: none`. **Acceptance criterion in S03**: play a track from Music tab, switch to Dashboard, switch back — audio is at the same time position and still playing. If this breaks, fall back to `visibility: hidden + position: absolute + height: 0` (uglier but reliably keeps audio alive).

### 10.5 `project.byId` deprecation

Search for callers before deleting:

```bash
grep -rn "project\.byId\|projectRouter\.byId" apps/web/src
```

If non-page callers exist, leave `project.byId` in place with the deprecation comment + delete in a follow-up PR.

### 10.6 Cross-version unresolved query perf

The `track_comments_version_unresolved_idx` covers the join + filter. If this query becomes slow at scale (>10k comments per project, very unlikely for a producer's lifetime portfolio), denormalize a `track_id` column on `track_comments` in a follow-up. Don't do this prematurely.

---

## 11. File-path index (for Dev subagents)

**Schema:**
- [`packages/db/src/schema.ts`](packages/db/src/schema.ts) — `trackComments` (line 447), `trackVersions`, `tracks`, `projects`
- [`packages/db/drizzle/0035_track_comments_range_and_dashboard.sql`](packages/db/drizzle/0035_track_comments_range_and_dashboard.sql) — new migration

**tRPC:**
- [`apps/web/src/server/trpc/routers/project-room.ts`](apps/web/src/server/trpc/routers/project-room.ts) — new
- [`apps/web/src/server/trpc/routers/project.ts`](apps/web/src/server/trpc/routers/project.ts) — `project.byId` deprecated
- [`apps/web/src/server/trpc/_app.ts`](apps/web/src/server/trpc/_app.ts) — mount the new router
- [`apps/web/src/server/trpc/routers/__tests__/`](apps/web/src/server/trpc/routers/__tests__/) — new test files

**Pages + components (existing, to modify):**
- [`apps/web/src/app/(app)/dashboard/projects/[id]/page.tsx`](apps/web/src/app/(app)/dashboard/projects/[id]/page.tsx)
- [`apps/web/src/components/dashboard/project/project-sub-tabs.tsx`](apps/web/src/components/dashboard/project/project-sub-tabs.tsx)
- [`apps/web/src/components/dashboard/project/project-sub-tab-shared.ts`](apps/web/src/components/dashboard/project/project-sub-tab-shared.ts)
- [`apps/web/src/components/dashboard/project/sub-tabs/music-sub-tab.tsx`](apps/web/src/components/dashboard/project/sub-tabs/music-sub-tab.tsx) — full rewrite
- [`apps/web/src/components/dashboard/project/sub-tabs/notes-sub-tab.tsx`](apps/web/src/components/dashboard/project/sub-tabs/notes-sub-tab.tsx) — delete

**New components:**
- [`apps/web/src/components/dashboard/project/sub-tabs/dashboard-sub-tab.tsx`](apps/web/src/components/dashboard/project/sub-tabs/dashboard-sub-tab.tsx)
- [`apps/web/src/components/dashboard/project/dashboard/`](apps/web/src/components/dashboard/project/dashboard/) — 5 module components
- [`apps/web/src/components/dashboard/project/sub-tabs/music/`](apps/web/src/components/dashboard/project/sub-tabs/music/) — 4 sub-components

**Audio + R2 (no source changes; only config):**
- [`apps/web/src/components/audio/use-multipart-upload.ts`](apps/web/src/components/audio/use-multipart-upload.ts) — reused
- [`apps/web/src/components/audio/persistent-player.tsx`](apps/web/src/components/audio/persistent-player.tsx) — reused
- [`apps/web/src/server/storage/r2-cors.ts`](apps/web/src/server/storage/r2-cors.ts) — verified, not edited
- [`apps/web/scripts/apply-r2-cors.mjs`](apps/web/scripts/apply-r2-cors.mjs) — re-run if needed

---

*End of Architecture doc. SM phase next: 7 self-contained story files at `docs/plans/stories/project-room-*`.*
