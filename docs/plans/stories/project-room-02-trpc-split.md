# Story 02 — tRPC procedure split (5 per-tab queries + 5 Music mutations)

**Epic:** Project Room redesign 2026-04-26
**Architecture ref:** [`docs/plans/active/2026-04-26-project-room-redesign-architecture.md` § 4 tRPC procedure split](../active/2026-04-26-project-room-redesign-architecture.md)
**Depends on:** S01 (schema migration — needs the new columns)
**Blocks:** S03 (sub-tab perf — wires the per-tab queries client-side), S04 (Dashboard UI), S05 (Music UX), S06 (range comments)
**Subagent:** `skitza-tdd-implementer`

## Goal

Replace the current monolithic `project.byId` aggregation (which returns everything for all 4 tabs in one server round-trip) with 5 per-tab queries + 5 mutations on a new router file. Each procedure scopes by `ctx.producerId` in its WHERE clause; tests assert this via `findPredicate`.

The fat `project.byId` is **deprecated, not deleted** — keep for one release until the page (S03) migrates off it.

## User story

As a producer, I want each Project Room sub-tab's data to load independently so switching tabs doesn't refetch unrelated data, and the Music tab can mutate tracks/versions/comments without going through a fat aggregation procedure.

## Acceptance criteria

### Queries
- [ ] New file [`apps/web/src/server/trpc/routers/project-room.ts`](../../apps/web/src/server/trpc/routers/project-room.ts) exists.
- [ ] Mounted under `appRouter.projectRoom` in [`apps/web/src/server/trpc/_app.ts`](../../apps/web/src/server/trpc/_app.ts).
- [ ] `projectRoom.shell({ projectId })` — minimal page-shell data (title, artistName, artistAvatarUrl, stage, paymentStatus, tagPills). ~10 columns. No fan-out.
- [ ] `projectRoom.dashboard({ projectId })` — aggregated for §11.5 Dashboard tab (latestVersion, whatsNext, recentActivity, openComments, sidebar.{stage,money,nextSession,fileCount,fileTotalBytes,artist}).
- [ ] `projectRoom.music({ projectId })` — tracks + versions + comments, including `unresolvedComments` joined across all versions of a track (the cross-version persistence query — see S06).
- [ ] `projectRoom.sessions({ projectId })` — bookings list (existing scope, just relocated).
- [ ] `projectRoom.money({ projectId })` — paid/outstanding/next + invoices + contractSummary + stripePaymentMethods (existing scope).

### Mutations
- [ ] `projectRoom.createTrackFromUpload({ projectId, filename, fileSize })` — replaces the title-first form. Server derives title from filename (strip suffixes — see §11.6 acceptance). Returns `{ trackId, versionId, presignedMultipartInit }`.
- [ ] `projectRoom.addVersionFromUpload({ trackId, filename, fileSize })` — drop-on-row → new version. Returns `{ versionId, presignedMultipartInit }`.
- [ ] `projectRoom.setVersionStatus({ versionId, status })` — flips `track_versions.status` between `'draft' | 'revisit' | 'final'`. Both producer + artist allowed (subject to identity check).
- [ ] `projectRoom.addRangeComment({ versionId, body, timestampMs, endTimestampMs })` — validates `endTimestampMs > timestampMs`; clamps to `>= 0`. Existing point-comment procedure stays.
- [ ] `projectRoom.resolveComment({ commentId })` + `projectRoom.unresolveComment({ commentId })` — toggle `resolved_at`. Both sides allowed.

### Auth scoping
- [ ] All queries and mutations use `producerProcedure` (existing — Clerk + producer row check).
- [ ] Every WHERE includes `producerId = ctx.producerId` directly OR via a join chain to `projects.producerId`. Tests assert via `findPredicate(where, projectsMarker, "producerId", ctx.producerId)`.
- [ ] Project not found OR project belongs to a different producer → throw `TRPCError({ code: "NOT_FOUND" })` (NOT `FORBIDDEN` — avoid enumeration).

### Deprecation
- [ ] `project.byId` in [`apps/web/src/server/trpc/routers/project.ts`](../../apps/web/src/server/trpc/routers/project.ts) gets a `@deprecated` JSDoc comment pointing to `projectRoom.*` procedures. Body unchanged.
- [ ] Grep confirms only callers of `project.byId` are: the page itself (`apps/web/src/app/(app)/dashboard/projects/[id]/page.tsx`) and any tests. No other components rely on it.

### Tests
- [ ] One test file per procedure under `apps/web/src/server/trpc/routers/__tests__/project-room.<name>.test.ts`. Marker-mock pattern (per CLAUDE.md). Each tests:
  - Auth scoping via `findPredicate`.
  - Returned shape matches the documented type.
  - `NOT_FOUND` when project doesn't exist or belongs to another producer.
- [ ] `/skitza-verify` passes.

## Technical context

### Input schema (shared)

```ts
const projectIdInput = z.object({ projectId: z.string().uuid() });
```

### Procedure shapes

See architecture doc §4.2 for the full return-type signatures. Implementation hints:

- **`projectRoom.dashboard`**: derive `whatsNext` from project state via the precedence list in PRD §11.5 (contract not signed → unpaid invoice → session within 48h → unread artist comment → latest version awaiting review → hidden). Fan-out via `Promise.all` over the legs.
- **`projectRoom.music.unresolvedComments`**: SQL pattern (cross-version unresolved):
  ```sql
  SELECT tc.* FROM track_comments tc
  JOIN track_versions tv ON tv.id = tc.version_id
  WHERE tv.track_id = $trackId
    AND tc.resolved_at IS NULL
  ORDER BY tc.created_at DESC
  ```
  Drizzle equivalent: `db.select(...).from(trackComments).innerJoin(trackVersions, eq(trackVersions.id, trackComments.versionId)).where(and(eq(trackVersions.trackId, trackId), isNull(trackComments.resolvedAt)))`. The new index from S01 covers this.
- **`projectRoom.createTrackFromUpload`**: title derivation = strip extension + strip `_v\d+` / `_master` / `_mix` / `_final` suffixes + trim. Reuse / extend existing `buildAudioKey` in [`apps/web/src/server/storage/r2.ts`](../../apps/web/src/server/storage/r2.ts). Return the existing `presignedMultipartInit` shape that `useMultipartUpload` already consumes (see [`apps/web/src/components/audio/use-multipart-upload.ts`](../../apps/web/src/components/audio/use-multipart-upload.ts)).
- **`projectRoom.setVersionStatus`**: enforce identity via the project's `producerId` (producer-side) OR via the artist-email match if we need artist-side toggling — for v1, scope to `producerProcedure` only; artist-side flip can come later as a magic-link or `artistProcedure` follow-up. (Confirm with PM if artist-side flip is in v1 scope; PRD §11.6 says "Both sides can flip the pill" but this could ship in S05.)

### Mock-DB pattern (CLAUDE.md canonical example)

See [`apps/web/src/server/trpc/routers/__tests__/artist-home.test.ts`](../../apps/web/src/server/trpc/routers/__tests__/artist-home.test.ts) — marker objects per table, `findPredicate` walks the WHERE tree.

```ts
const projectsMarker = { __table: "projects" };
const trackVersionsMarker = { __table: "track_versions" };
// ... etc

const dbMock = {
  select: () => ({
    from: (t: unknown) => {
      if (t === projectsMarker) return /* fixture */;
      // ...
      throw new Error(`unexpected select().from(${String(t)})`);
    },
  }),
};

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  projects: projectsMarker,
  trackVersions: trackVersionsMarker,
  // ...
  eq, and, isNull, // re-export
}));
```

## TDD steps

1. **RED — `projectRoom.shell`**: test asserts auth-scoping + shape. Run — fails (procedure missing).
2. **GREEN** — implement minimal `shell` query.
3. **RED + GREEN** — `projectRoom.dashboard`. The test fixture stubs `latestVersion`, `recentActivity`, `openComments` — assert all 5 modules are populated, and `whatsNext` precedence is honored (insert a project with `contractStatus !== 'signed'` and assert `whatsNext.kind === 'send_contract'`).
4. **RED + GREEN** — `projectRoom.music`. Test the cross-version unresolved query specifically: setup track with V1+V2, one resolved comment on V1, one unresolved on V1, one unresolved on V2 — assert `tracks[0].unresolvedComments.length === 2` and the resolved one is absent.
5. **RED + GREEN** — `projectRoom.sessions`, `projectRoom.money`. Mostly relocations of existing logic; tests confirm shape unchanged.
6. **RED + GREEN per mutation** — `createTrackFromUpload`, `addVersionFromUpload`, `setVersionStatus`, `addRangeComment`, `resolveComment`, `unresolveComment`. For `addRangeComment`, assert validation: `endTimestampMs > timestampMs` required.
7. Mark `project.byId` as `@deprecated`. Confirm via grep that only `page.tsx` + tests still reference it.
8. `/skitza-verify` — full pipeline.

## Test file paths

- `apps/web/src/server/trpc/routers/__tests__/project-room.shell.test.ts`
- `apps/web/src/server/trpc/routers/__tests__/project-room.dashboard.test.ts`
- `apps/web/src/server/trpc/routers/__tests__/project-room.music.test.ts`
- `apps/web/src/server/trpc/routers/__tests__/project-room.music-cross-version.test.ts` (the unresolved-across-versions specifically — separated for clarity)
- `apps/web/src/server/trpc/routers/__tests__/project-room.sessions.test.ts`
- `apps/web/src/server/trpc/routers/__tests__/project-room.money.test.ts`
- `apps/web/src/server/trpc/routers/__tests__/project-room.mutations.test.ts` (or one per mutation if cleaner)

## Definition of done

- [ ] All 10 procedures implemented + tested
- [ ] `project.byId` marked `@deprecated`
- [ ] No existing tests regress
- [ ] `/skitza-verify` passes

## Commit message

```
feat(trpc): split Project Room into per-tab procedures

Replaces the monolithic project.byId aggregation with 5 per-tab queries
+ 5 Music mutations on a new projectRoom router. Each procedure scopes
by ctx.producerId in its WHERE clause (asserted via findPredicate);
project not found / wrong producer throws NOT_FOUND (not FORBIDDEN —
avoid enumeration).

Queries: shell (header chrome — 10-column shape), dashboard (§11.5
modules + meta sidebar), music (tracks + versions + cross-version
unresolved comments), sessions (bookings), money (invoices + contract
summary + stripe payment methods).

Mutations: createTrackFromUpload (replaces the title-first form —
server derives title from filename), addVersionFromUpload (drop-on-row
→ new version), setVersionStatus (bilateral 'draft'|'revisit'|'final'),
addRangeComment (validated endTimestampMs > timestampMs), resolveComment
+ unresolveComment.

projectRoom.music.unresolvedComments uses the
track_comments_version_unresolved_idx index from S01 — joins
track_comments → track_versions on track_id, filters by resolved_at
IS NULL. Powers the Replay-style cross-version comment persistence
in S06.

project.byId marked @deprecated, body unchanged. Removed in a
follow-up after the page (S03) migrates off it.

Story 02 of the project-room-redesign epic. Depends on S01 (schema).
Blocks S03 / S04 / S05 / S06.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
