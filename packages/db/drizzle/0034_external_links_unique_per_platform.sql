-- Story 06 of onboarding rebuild — unique constraint on
-- (producer_id, platform) for producer_external_links.
--
-- Why now: the onboarding wizard's portfolio step exposes 3 platform
-- inputs (Spotify / YouTube / Instagram). On Save, the server action
-- upserts each non-empty URL with ON CONFLICT (producer_id, platform)
-- DO UPDATE — which requires a unique constraint to target. Without
-- one, the upsert errors at runtime and the producer's links never
-- save. The original 0031 migration only created an index on
-- (producer_id, position) for list-by-position lookups; uniqueness
-- per platform was deferred until a UI surface needed it.
--
-- De-dup first, constrain second:
--   1. DELETE rows that would violate the constraint, keeping the
--      most recent (created_at DESC, id DESC tiebreaker) per
--      (producer_id, platform). Row-number window function makes the
--      "keep newest, drop the rest" trivial — the cascade chain on
--      producers ensures any cross-producer rows are isolated.
--   2. ADD CONSTRAINT, idempotent via the pg_constraint catalog check
--      so re-running the migration is safe.
--
-- Idempotency: both DELETE (no-op when there are no duplicates) and
-- ADD CONSTRAINT (skipped if already present) tolerate re-execution.
-- Apply via /skitza-migrate per CLAUDE.md (the journal is broken past
-- 0028; do NOT touch _journal.json here).

BEGIN;

-- De-dup any existing rows that would violate the new constraint:
-- keep the most recent row per (producer_id, platform), drop older
-- duplicates. The 'id IN (subquery)' pattern is portable + index-
-- friendly (the inner CTE produces a small id list).
DELETE FROM producer_external_links
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY producer_id, platform
      ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM producer_external_links
  ) t
  WHERE t.rn > 1
);

-- Add the unique constraint, idempotent via pg_constraint catalog
-- check. Drizzle's `unique("producer_external_links_producer_platform_unique")`
-- in schema.ts maps to this constraint name verbatim.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'producer_external_links_producer_platform_unique'
  ) THEN
    ALTER TABLE producer_external_links
      ADD CONSTRAINT producer_external_links_producer_platform_unique
      UNIQUE (producer_id, platform);
  END IF;
END $$;

COMMIT;
