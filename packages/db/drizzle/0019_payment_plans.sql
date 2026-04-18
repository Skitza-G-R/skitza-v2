-- Stripe auto-installments — add payment-plan execution state.
-- One plan per project (no separate instance table — one-to-one
-- doesn't justify a join). Producers expose enabled plans per
-- product via the new payment_plans jsonb column.
BEGIN;

-- 1. Extend project_stage enum with the paused state. When monthly
-- retries exhaust, projects flip here; client self-booking locks
-- until payment method is updated.
ALTER TYPE "project_stage" ADD VALUE IF NOT EXISTS 'payment_paused';
ALTER TYPE "project_stage" ADD VALUE IF NOT EXISTS 'cancelled';

-- 2. projects: plan state columns. Nulls acceptable — existing
-- rows stay as "no plan configured" until a payment activates one.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "payment_plan_kind" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "installments" integer;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "stripe_payment_method_id" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "stripe_subscription_schedule_id" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "charges_completed" integer NOT NULL DEFAULT 0;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "charges_total" integer;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "next_charge_at" timestamp with time zone;

-- 3. products: plans offered. Default to [{"kind":"full"}] so legacy
-- products keep working without edit.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "payment_plans" jsonb
  NOT NULL DEFAULT '[{"kind":"full"}]'::jsonb;

-- 4. invoices: new FK + kind value. FK is nullable because legacy
-- one-time invoices don't have a plan.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_plan_project_id" uuid
  REFERENCES "projects"("id") ON DELETE SET NULL;
-- `kind` stays text (no enum) so we don't need an ALTER TYPE for
-- the new 'installment' value — just start writing it.

-- 5. stripe_customers: one per (producer, client) pair. Reused
-- across projects so saved cards carry over. Composite PK prevents
-- duplicates.
CREATE TABLE IF NOT EXISTS "stripe_customers" (
  "producer_id" uuid NOT NULL REFERENCES "producers"("id") ON DELETE CASCADE,
  "client_contact_id" uuid NOT NULL REFERENCES "client_contacts"("id") ON DELETE CASCADE,
  "stripe_customer_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("producer_id", "client_contact_id")
);

-- 6. Index for webhook lookups — handlers need to find a project
-- by its Stripe schedule id quickly.
CREATE INDEX IF NOT EXISTS "projects_stripe_schedule_idx"
  ON "projects" ("stripe_subscription_schedule_id")
  WHERE "stripe_subscription_schedule_id" IS NOT NULL;

COMMIT;
