-- Task 7 (Stripe auto-installments): producer-triggered final charge
-- needs to know the original total so it can compute the second-half
-- amount via calculateCharges(plan, totalCents)[1].
--
-- Inferring total from the deposit invoice alone is ambiguous (a
-- $100.01 total and a $100.00 total both produce a $50.01 deposit for
-- the 50/50 plan, because the ceil-half remainder lands on the first
-- charge). Add an explicit column so downstream math is exact.
--
-- Backfill strategy: for rows that already have a deposit invoice
-- recorded, use 2 * amountCents (the ambiguous case above is rare and
-- only drifts by 1 cent — tolerable for legacy rows; new rows get the
-- exact value persisted at checkout time).
BEGIN;

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "total_amount_cents" integer;

-- Backfill from existing deposit invoices (ignores plan-less legacy
-- rows, which keep NULL and can't trigger off-session charges anyway).
UPDATE "projects" p
SET "total_amount_cents" = inv.amount_cents * 2
FROM (
  SELECT DISTINCT ON (project_id) project_id, amount_cents
  FROM "invoices"
  WHERE kind = 'deposit' AND project_id IS NOT NULL
  ORDER BY project_id, created_at DESC
) inv
WHERE p.id = inv.project_id
  AND p.total_amount_cents IS NULL
  AND p.payment_plan_kind = 'split_50_50';

COMMIT;
