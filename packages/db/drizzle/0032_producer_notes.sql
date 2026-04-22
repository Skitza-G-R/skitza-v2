-- Audit Task 11 — producer_notes table.
--
-- Context: the Today page's Quick Note modal has been a localStorage
-- stub since launch. Notes live in the browser, don't sync across
-- devices, and evaporate on cache clear. This migration adds the
-- real DB backing so the producer's ad-hoc jots become a persistent
-- first-class feature.
--
-- Ordering: indexed on (producer_id, created_at desc) so the
-- listNotes query returns newest-first without a sort at the app
-- layer. Hot path for the Today page.
--
-- Body is text (no length limit at DB layer — enforced upstream in
-- the tRPC input schema so we can keep the constraint tweakable
-- without a migration). Reasonable default soft-cap: 4000 chars.
--
-- Idempotent: IF NOT EXISTS on the table + index. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS "producer_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "producer_id" uuid NOT NULL REFERENCES "producers"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "producer_notes_producer_created_idx"
  ON "producer_notes" ("producer_id", "created_at" DESC);

COMMIT;
