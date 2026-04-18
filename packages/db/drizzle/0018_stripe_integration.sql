-- Phase H.5 — Stripe Connect + invoices.
-- 1. Producers gain `stripe_charges_enabled`. (`stripe_account_id`
--    already exists from an earlier migration; ALTER ... IF NOT EXISTS
--    is a no-op when present.)
-- 2. Bookings gain `stripe_checkout_session_id` so the booking detail
--    page can deep-link to the Stripe dashboard without joining
--    invoices.
-- 3. New `invoices` table — one row per Checkout Session, linked
--    loosely to a producer/project/booking. SET NULL on the parent
--    deletes preserves the financial ledger.
BEGIN;

ALTER TABLE "producers" ADD COLUMN IF NOT EXISTS "stripe_account_id" text;
ALTER TABLE "producers" ADD COLUMN IF NOT EXISTS "stripe_charges_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "stripe_checkout_session_id" text;

DO $$ BEGIN
  CREATE TYPE "invoice_status" AS ENUM('draft','sent','paid','refunded','void','uncollectible');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "producer_id" uuid NOT NULL,
  "project_id" uuid,
  "booking_id" uuid,
  "stripe_checkout_session_id" text,
  "stripe_payment_intent_id" text,
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL,
  "description" text,
  "kind" text NOT NULL,
  "status" "invoice_status" NOT NULL DEFAULT 'draft',
  "customer_email" text,
  "customer_name" text,
  "paid_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_producer_id_fk" FOREIGN KEY ("producer_id") REFERENCES "producers"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "invoices_producer_created_idx" ON "invoices" ("producer_id", "created_at");

COMMIT;
