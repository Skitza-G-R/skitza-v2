-- Stripe fires invoice.paid + payment_intent.succeeded near-
-- simultaneously for subscription invoices. Without a DB-level
-- uniqueness guard, both webhook handlers can pass a SELECT-check
-- and both INSERT, producing duplicate ledger rows (chargesCompleted
-- stays correct via advancePlanState's guard but the ledger is
-- double-counted).
--
-- Partial unique index: only enforces uniqueness where PI is
-- non-null, so legacy invoices without stripePaymentIntentId
-- (deposits before checkout completion, manual invoices) are
-- unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_stripe_payment_intent_unique"
  ON "invoices" ("stripe_payment_intent_id")
  WHERE "stripe_payment_intent_id" IS NOT NULL;
