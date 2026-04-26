-- Migration 0035 — Project Room redesign foundation
-- Adds two columns + one index to support the redesigned Music tab:
--   1. track_comments.end_timestamp_ms (nullable INTEGER) — when non-NULL,
--      the comment is a range comment spanning [timestamp_ms, end_timestamp_ms]
--      on the waveform. NULL preserves existing point-comment semantics.
--   2. track_versions.status (TEXT NOT NULL DEFAULT 'draft' CHECK constraint) —
--      drives the bilateral status pill. Producer view: Draft/Revisit/Final;
--      artist view: In progress/Needs work/Approved. Same DB column, different
--      copy by viewer role.
--   3. Index track_comments_version_unresolved_idx — covers the cross-version
--      unresolved-comments query in S06 (joins on version_id, filters by
--      resolved_at IS NULL).
--
-- Why TEXT + CHECK instead of pgEnum: PG enums require CREATE TYPE
-- (irreversible) and ALTER TYPE ADD VALUE (out-of-transaction only). TEXT +
-- CHECK is forward-compatible — adding a 4th status later is a single ALTER.
-- See architecture doc § 10.3.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS) — safe to
-- re-run via /skitza-migrate (canonical workflow until the drizzle journal is
-- fixed past 0028 — see CLAUDE.md mistake log 2026-04-20).

BEGIN;

ALTER TABLE track_comments
  ADD COLUMN IF NOT EXISTS end_timestamp_ms INTEGER;

ALTER TABLE track_versions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft', 'revisit', 'final'));

CREATE INDEX IF NOT EXISTS track_comments_version_unresolved_idx
  ON track_comments (version_id, resolved_at);

COMMIT;
