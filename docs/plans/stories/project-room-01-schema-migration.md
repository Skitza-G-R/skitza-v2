# Story 01 — Schema migration 0035 (range-comment column + version status)

**Epic:** Project Room redesign 2026-04-26
**Architecture ref:** [`docs/plans/active/2026-04-26-project-room-redesign-architecture.md` § 2 Schema changes](../active/2026-04-26-project-room-redesign-architecture.md)
**Depends on:** none — foundation story
**Blocks:** S02 (tRPC split), S05 (status pill UI), S06 (range comments + cross-version unresolved)
**Subagent:** `skitza-tdd-implementer`

## Goal

Add two columns to existing tables so the redesigned Music tab can store range comments (drag-on-waveform) and per-version bilateral status. Idempotent migration applied via `/skitza-migrate` (the journal is broken past 0028 — see CLAUDE.md, do NOT touch `_journal.json`).

## User story

As a producer, I want my database to support storing range-based audio feedback (e.g. "verse 0:30–1:15 needs work") and per-version status flags (Draft / Revisit / Final), so that the redesigned Music tab can persist these new interactions.

## Acceptance criteria

- [ ] New file `packages/db/drizzle/0035_track_comments_range_and_dashboard.sql` exists.
- [ ] Migration is wrapped in `BEGIN; … COMMIT;`.
- [ ] All schema changes use `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` so re-running is safe.
- [ ] `track_comments.end_timestamp_ms INTEGER` is added (nullable — NULL means point comment, non-NULL means range comment from `timestamp_ms` to `end_timestamp_ms`).
- [ ] `track_versions.status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'revisit', 'final'))` is added. Existing rows pick up `'draft'` via the DEFAULT.
- [ ] Index `track_comments_version_unresolved_idx` on `(version_id, resolved_at)` exists — covers the cross-version unresolved-comments query in S06.
- [ ] `packages/db/src/schema.ts` updated:
  - `trackComments` (line 447-ish): add `endTimestampMs: integer("end_timestamp_ms")` (no `.notNull()`).
  - `trackVersions`: add `status: text("status").notNull().default("draft")` plus an explicit type narrowing or use a Zod parser at the procedure layer (TEXT + CHECK is forward-compatible; we deliberately do NOT use a Postgres ENUM — see Architecture §10.3).
- [ ] DB integration test in `packages/db/src/__tests__/0035-track-comments-range.test.ts` proves: round-trip a comment with `endTimestampMs = NULL` (point), round-trip one with `endTimestampMs = 90000` (range), assert `status = 'draft'` on a freshly-inserted version, assert the index exists via `pg_indexes`.
- [ ] `/skitza-migrate` runs the migration cleanly against `$DATABASE_URL_TEST`.
- [ ] `/skitza-verify` passes (typecheck + lint + test).

## Technical context

### Schema files to touch

- [`packages/db/drizzle/0035_track_comments_range_and_dashboard.sql`](../../packages/db/drizzle/0035_track_comments_range_and_dashboard.sql) — new file
- [`packages/db/src/schema.ts`](../../packages/db/src/schema.ts) — `trackComments` table at line 447, `trackVersions` table (find by grep)

### SQL contents (verbatim)

```sql
BEGIN;

-- Range comments: nullable end-time. NULL = point comment (existing
-- semantics). Non-NULL = range comment spanning timestamp_ms -> end_timestamp_ms.
ALTER TABLE track_comments
  ADD COLUMN IF NOT EXISTS end_timestamp_ms INTEGER;

-- Per-version status for the bilateral status pill (Draft/Revisit/Final
-- on producer side, In progress/Needs work/Approved on artist side —
-- same DB enum, different UI copy by viewer role).
ALTER TABLE track_versions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft', 'revisit', 'final'));

-- Index supporting the cross-version unresolved query (S06):
-- "give me unresolved comments for track X across all versions, newest first."
-- Joined query traverses track_comments.version_id -> track_versions.track_id.
CREATE INDEX IF NOT EXISTS track_comments_version_unresolved_idx
  ON track_comments (version_id, resolved_at);

COMMIT;
```

### Why TEXT + CHECK for status (not PG ENUM)

Architecture §10.3: PG enums require `CREATE TYPE` (irreversible without `DROP TYPE`) and `ALTER TYPE ADD VALUE` (must run outside transactions). TEXT + CHECK is forward-compatible — adding a 4th status later is `ALTER COLUMN ... CHECK (...)`. TEXT wins.

### schema.ts updates

```ts
// Inside trackComments (existing table):
export const trackComments = pgTable("track_comments", {
  // ... existing columns ...
  timestampMs: integer("timestamp_ms").notNull(),
  endTimestampMs: integer("end_timestamp_ms"),  // <-- ADD (nullable)
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  // ... existing columns ...
});

// Inside trackVersions (existing table):
export const trackVersions = pgTable("track_versions", {
  // ... existing columns ...
  status: text("status").notNull().default("draft"),  // <-- ADD
  // ... existing columns ...
});

// Optional convenience type:
export type VersionStatus = "draft" | "revisit" | "final";
```

## TDD steps

1. **RED** — write `packages/db/src/__tests__/0035-track-comments-range.test.ts` against `DATABASE_URL_TEST`:
   - Setup: create a producer, project, track, version (default status should be `'draft'`).
   - Insert a point comment (`endTimestampMs = NULL`). Read back. Assert `endTimestampMs === null`.
   - Insert a range comment (`timestampMs = 30000, endTimestampMs = 90000`). Read back. Assert both fields preserved.
   - Run `SELECT indexname FROM pg_indexes WHERE indexname = 'track_comments_version_unresolved_idx'`. Assert one row.
   - Run — fails because the migration hasn't run yet (column doesn't exist).
2. **GREEN** — write the SQL migration file. Run `/skitza-migrate` against test DB. Re-run test. Goes green.
3. Update `schema.ts` to declare the new columns + types.
4. `pnpm -F @skitza/db db:generate` MUST NOT generate a new diff (the schema.ts now matches the SQL we wrote). If it does, the schema and SQL drifted — reconcile.
5. `/skitza-verify` — full typecheck/lint/test pipeline.

## Test file paths

- `packages/db/src/__tests__/0035-track-comments-range.test.ts` — new

Reference for the integration-test pattern: see `packages/db/src/__tests__/` for existing examples — they all use `DATABASE_URL_TEST` and a `beforeEach` that wraps in a transaction + rollback.

## Definition of done

- [ ] `0035_track_comments_range_and_dashboard.sql` committed
- [ ] schema.ts reflects both new columns
- [ ] Integration test green against `DATABASE_URL_TEST`
- [ ] `/skitza-migrate` applied locally (Gili reapplies to prod after merge — this is part of the standard post-merge ops playbook in CLAUDE.md)
- [ ] `/skitza-verify` passes

## Commit message

```
feat(db): migration 0035 — range-comment end_timestamp_ms + version status

Foundation schema change for the Project Room redesign. Adds:

- track_comments.end_timestamp_ms (nullable INTEGER) — when non-NULL,
  the comment is a range comment spanning [timestamp_ms, end_timestamp_ms]
  on the waveform. NULL preserves existing point-comment semantics.

- track_versions.status (TEXT NOT NULL DEFAULT 'draft' CHECK ('draft' |
  'revisit' | 'final')) — drives the bilateral status pill in the new
  Music tab UI. Producer view reads "Draft / Revisit / Final"; artist
  view reads "In progress / Needs work / Approved" — same DB column,
  different copy at render time.

- Index track_comments_version_unresolved_idx on (version_id, resolved_at)
  — covers the cross-version unresolved-comments query that powers the
  Replay-style "comments from V1 still visible on V2 until resolved"
  feature in S06.

Why TEXT + CHECK instead of pgEnum: PG enums require CREATE TYPE
(irreversible) and ALTER TYPE ADD VALUE (out-of-transaction only). TEXT
+ CHECK is forward-compatible — adding a 4th status later is one ALTER.
See architecture doc §10.3.

Idempotent (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS) —
safe to re-run via /skitza-migrate (the canonical workflow until the
drizzle journal is fixed past 0028 — see CLAUDE.md mistake log).

Story 01 of the project-room-redesign epic. Blocks S02, S05, S06.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
