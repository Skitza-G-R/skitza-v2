-- Purchase-flow hardening (2026-07-10)
-- Production cutover: docs/runbooks/purchase-proof-hardening-cutover.md
--
-- The repository migrator auto-commits each top-level SQL statement and keeps
-- going after an error. Keep this migration in ONE DO statement so its
-- preflight and schema changes are atomic even under that runner.
--
-- The short-lived invoice-backed proof model stored objects in the public
-- audio bucket. The configured deployment database inventory returned zero
-- such rows before this migration shipped. If one appears before deploy, stop without changing or
-- deleting it: public proof objects require an explicit, lossless move to the
-- private docs bucket, not an automatic metadata rewrite.

DO $migration$
BEGIN
  -- Close the check-then-migrate race with any still-running old server.
  -- This mode permits reads but blocks invoice writes until 0023 commits.
  LOCK TABLE "invoices" IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1
    FROM "invoices"
    WHERE "purchase_request_id" IS NOT NULL
      AND "proof_file_url" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SKITZA_0023_LEGACY_PROOFS_REQUIRE_MANUAL_PRESERVATION';
  END IF;

  -- Once the zero-row preflight succeeds, keep the previous app version from
  -- creating an invoice-backed public proof during a rolling code deploy.
  BEGIN
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoices_legacy_purchase_proof_disabled"
      CHECK ("purchase_request_id" IS NULL OR "proof_file_url" IS NULL);
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  ALTER TABLE "purchase_requests"
    ADD COLUMN IF NOT EXISTS "payment_plan_options_snapshot" jsonb;

  ALTER TABLE "purchase_requests"
    ADD COLUMN IF NOT EXISTS "payment_plan_chosen_at" timestamp with time zone;

  UPDATE "purchase_requests"
  SET "payment_plan_options_snapshot" = jsonb_build_array("payment_plan_snapshot")
  WHERE "payment_plan_options_snapshot" IS NULL;

  -- Keep this nullable for rolling-deploy compatibility with the previous
  -- app version. New code always writes it and safely falls back to the
  -- provisional plan for a row created during the deploy window.

  -- Requests that already reached the payment loop predate the explicit-choice
  -- marker. Treat their existing snapshot as chosen so a deploy is non-breaking.
  UPDATE "purchase_requests"
  SET "payment_plan_chosen_at" = COALESCE("approved_at", "created_at")
  WHERE "payment_plan_chosen_at" IS NULL
    AND "status" IN ('approved', 'verifying', 'paid');

  BEGIN
    CREATE TYPE "public"."payment_proof_status" AS ENUM ('pending', 'confirmed', 'rejected');
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

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
    "object_etag" text,
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

  -- Supports a safe re-run after an older partial application of 0023.
  ALTER TABLE "payment_proofs"
    ADD COLUMN IF NOT EXISTS "storage_bucket" text DEFAULT 'docs' NOT NULL;
  ALTER TABLE "payment_proofs"
    ADD COLUMN IF NOT EXISTS "object_etag" text;
  BEGIN
    ALTER TABLE "payment_proofs"
      ADD CONSTRAINT "payment_proofs_private_docs_bucket_only"
      CHECK ("storage_bucket" = 'docs');
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  CREATE UNIQUE INDEX IF NOT EXISTS "payment_proofs_storage_key_unique"
    ON "payment_proofs" ("storage_key");
  CREATE INDEX IF NOT EXISTS "payment_proofs_purchase_status_idx"
    ON "payment_proofs" ("purchase_request_id", "status");
  CREATE INDEX IF NOT EXISTS "payment_proofs_producer_status_created_idx"
    ON "payment_proofs" ("producer_id", "status", "created_at");
  CREATE UNIQUE INDEX IF NOT EXISTS "payment_proofs_one_pending_per_request"
    ON "payment_proofs" ("purchase_request_id") WHERE "status" = 'pending';

  ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_proof_id" uuid;

  BEGIN
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoices_payment_proof_id_payment_proofs_id_fk"
      FOREIGN KEY ("payment_proof_id") REFERENCES "payment_proofs"("id") ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  CREATE UNIQUE INDEX IF NOT EXISTS "invoices_payment_proof_unique"
    ON "invoices" ("payment_proof_id") WHERE "payment_proof_id" IS NOT NULL;
END
$migration$;
