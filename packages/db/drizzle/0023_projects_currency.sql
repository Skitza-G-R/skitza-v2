-- Important 3 (Stripe auto-installments): persist currency on project
-- as the single source of truth.
--
-- The bug: page.tsx + chargeFinal each derive currency from a different
-- source (most recent invoice for the page, deposit invoice for the
-- mutation). A producer who changes a product's currency mid-engagement
-- (or has a manual intermediate invoice in a different currency) hits a
-- race where the modal shows currency-A and the server charges in B.
--
-- Fix: snapshot the currency on the project row at publicRequest time.
-- chargeFinal reads from there; page.tsx drops its lookup and uses the
-- project field directly.
--
-- Backfill: copy from each project's deposit invoice for plan-backed
-- projects. Plan-less legacy rows keep NULL — they have no producer-
-- triggered final charge surface anyway.
BEGIN;

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "currency" text;

UPDATE "projects" p
SET "currency" = (
  SELECT i.currency FROM "invoices" i
  WHERE i.project_id = p.id AND i.kind = 'deposit'
  ORDER BY i.created_at DESC
  LIMIT 1
)
WHERE p.payment_plan_kind IS NOT NULL
  AND p.currency IS NULL;

COMMIT;
