-- Purchase-flow hardening (2026-07-10)
--
-- 1. Freeze the full set of payment choices at request time.
-- 2. Move off-app proofs out of invoices so pending/rejected uploads never
--    affect revenue, balances, or reminder jobs.
-- 3. Link a confirmed proof to one paid invoice for idempotent accounting.

ALTER TABLE "purchase_requests"
  ADD COLUMN IF NOT EXISTS "payment_plan_options_snapshot" jsonb;

ALTER TABLE "purchase_requests"
  ADD COLUMN IF NOT EXISTS "payment_plan_chosen_at" timestamp with time zone;

UPDATE "purchase_requests"
SET "payment_plan_options_snapshot" = jsonb_build_array("payment_plan_snapshot")
WHERE "payment_plan_options_snapshot" IS NULL;

ALTER TABLE "purchase_requests"
  ALTER COLUMN "payment_plan_options_snapshot" SET NOT NULL;

-- Requests that already reached the payment loop predate the explicit-choice
-- marker. Treat their existing snapshot as chosen so a deploy is non-breaking.
UPDATE "purchase_requests"
SET "payment_plan_chosen_at" = COALESCE("approved_at", "created_at")
WHERE "payment_plan_chosen_at" IS NULL
  AND "status" IN ('approved', 'verifying', 'paid');

DO $$ BEGIN
  CREATE TYPE "public"."payment_proof_status" AS ENUM ('pending', 'confirmed', 'rejected');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "payment_proofs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purchase_request_id" uuid NOT NULL REFERENCES "purchase_requests"("id") ON DELETE CASCADE,
  "producer_id" uuid NOT NULL REFERENCES "producers"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "amount_cents" integer NOT NULL CHECK ("amount_cents" > 0),
  "currency" text NOT NULL,
  "kind" text NOT NULL,
  "storage_bucket" text DEFAULT 'docs' NOT NULL,
  "storage_key" text NOT NULL,
  "original_file_name" text,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL CHECK ("size_bytes" >= 0),
  "status" "public"."payment_proof_status" DEFAULT 'pending' NOT NULL,
  "note" text,
  "rejection_note" text,
  "confirmed_at" timestamp with time zone,
  "rejected_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "payment_proofs"
  ADD COLUMN IF NOT EXISTS "storage_bucket" text DEFAULT 'docs' NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "payment_proofs_storage_key_unique"
  ON "payment_proofs" ("storage_key");
CREATE INDEX IF NOT EXISTS "payment_proofs_purchase_status_idx"
  ON "payment_proofs" ("purchase_request_id", "status");
CREATE INDEX IF NOT EXISTS "payment_proofs_producer_status_created_idx"
  ON "payment_proofs" ("producer_id", "status", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_proofs_one_pending_per_request"
  ON "payment_proofs" ("purchase_request_id") WHERE "status" = 'pending';

-- Preserve any proof rows created by the short-lived invoice-backed model.
-- The object key is the path portion of the old public URL.
INSERT INTO "payment_proofs" (
  "id", "purchase_request_id", "producer_id", "project_id",
  "amount_cents", "currency", "kind", "storage_bucket", "storage_key", "content_type",
  "size_bytes", "status", "note", "rejection_note", "confirmed_at", "created_at"
)
SELECT
  i."id", i."purchase_request_id", i."producer_id", i."project_id",
  i."amount_cents", i."currency", i."kind", 'audio',
  regexp_replace(i."proof_file_url", '^https?://[^/]+/', ''),
  'application/octet-stream', 0,
  CASE
    WHEN i."status" = 'paid' THEN 'confirmed'::"public"."payment_proof_status"
    WHEN i."status" = 'void' THEN 'rejected'::"public"."payment_proof_status"
    ELSE 'pending'::"public"."payment_proof_status"
  END,
  i."proof_note", i."rejection_note", i."paid_at", i."created_at"
FROM "invoices" i
WHERE i."purchase_request_id" IS NOT NULL
  AND i."proof_file_url" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_proof_id" uuid;

DO $$ BEGIN
  ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_payment_proof_id_payment_proofs_id_fk"
    FOREIGN KEY ("payment_proof_id") REFERENCES "payment_proofs"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

UPDATE "invoices"
SET "payment_proof_id" = "id"
WHERE "proof_file_url" IS NOT NULL AND "status" = 'paid';

-- Pending/rejected proof rows are now represented only in payment_proofs.
DELETE FROM "invoices"
WHERE "proof_file_url" IS NOT NULL AND "status" IN ('sent', 'void');

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_payment_proof_unique"
  ON "invoices" ("payment_proof_id") WHERE "payment_proof_id" IS NOT NULL;
