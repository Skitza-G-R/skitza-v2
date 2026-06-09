-- 0021_purchase_requests.sql
--
-- SK-37 / BE-1 — artist purchase-flow keystone. Adds the request
-- lifecycle + price-lock snapshot (purchase_requests) and the inline
-- agreement acceptance record (agreement_acceptances), extends the
-- notification_kind enum with the four purchase-flow events, and adds a
-- click-through FK on notifications.
--
-- Idempotent + self-contained. Applied via the skitza-migrate skill
-- (packages/db/apply-migrations.mjs runs every drizzle/*.sql over the
-- Neon HTTP client, auto-committing each statement). NOT drizzle-kit —
-- its journal is stale. Re-running is a no-op (CREATE ... IF NOT EXISTS,
-- guarded CREATE TYPE, ADD VALUE IF NOT EXISTS, ADD COLUMN IF NOT
-- EXISTS). Keep this in exact lockstep with packages/db/src/schema.ts.

-- 1. New 3-state enum for the request status. Guarded so a re-run is a
--    no-op (CREATE TYPE has no IF NOT EXISTS).
DO $$ BEGIN
  CREATE TYPE "public"."purchase_request_status" AS ENUM ('pending', 'approved', 'declined');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 2. purchase_requests — the request + price-lock snapshot. FKs reuse
--    the existing engagement entities; *_snapshot columns are the
--    source of truth for amounts once the row exists.
CREATE TABLE IF NOT EXISTS "purchase_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "producer_id" uuid NOT NULL REFERENCES "producers"("id") ON DELETE CASCADE,
  "client_contact_id" uuid NOT NULL REFERENCES "client_contacts"("id") ON DELETE CASCADE,
  "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "booking_id" uuid REFERENCES "bookings"("id") ON DELETE SET NULL,
  "ref_number" text NOT NULL,
  "status" "public"."purchase_request_status" DEFAULT 'pending' NOT NULL,
  "status_changed_at" timestamp with time zone,
  "approved_at" timestamp with time zone,
  "declined_at" timestamp with time zone,
  "artist_name" text NOT NULL,
  "artist_email" text NOT NULL,
  "product_name_snapshot" text NOT NULL,
  "price_cents" integer NOT NULL,
  "currency" text NOT NULL,
  "payment_plan_snapshot" jsonb NOT NULL,
  "song_qty" integer,
  "unit_price_cents" integer,
  "contract_url_snapshot" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Unique artist-facing reference (collision guard for the minted code).
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_requests_ref_number_unique"
  ON "purchase_requests" ("ref_number");
-- Producer hub list: producer + status, newest first.
CREATE INDEX IF NOT EXISTS "purchase_requests_producer_status_idx"
  ON "purchase_requests" ("producer_id", "status", "created_at");
-- "one pending request per (artist, producer)" guard.
CREATE INDEX IF NOT EXISTS "purchase_requests_contact_status_idx"
  ON "purchase_requests" ("client_contact_id", "status");

-- 3. agreement_acceptances — inline checkbox acceptance, one per
--    request (UNIQUE makes acceptance idempotent). agreement_url is the
--    optional snapshot of products.contract_url.
CREATE TABLE IF NOT EXISTS "agreement_acceptances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purchase_request_id" uuid NOT NULL REFERENCES "purchase_requests"("id") ON DELETE CASCADE,
  "producer_id" uuid NOT NULL REFERENCES "producers"("id") ON DELETE CASCADE,
  "client_contact_id" uuid NOT NULL REFERENCES "client_contacts"("id") ON DELETE CASCADE,
  "accepted_by_clerk_user_id" text NOT NULL,
  "agreement_url" text,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "agreement_acceptances_request_unique"
  ON "agreement_acceptances" ("purchase_request_id");

-- 4. notifications.purchase_request_id — click-through for the producer
--    inbox (mirrors the existing nullable project_id/booking_id refs).
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "purchase_request_id" uuid
  REFERENCES "purchase_requests"("id") ON DELETE CASCADE;

-- 5. Extend notification_kind with the four purchase-flow events. Each
--    is its own statement; the runner auto-commits per statement so
--    ADD VALUE (which cannot run inside a transaction block) is safe.
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'purchase_requested';
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'purchase_approved';
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'purchase_declined';
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'agreement_accepted';
