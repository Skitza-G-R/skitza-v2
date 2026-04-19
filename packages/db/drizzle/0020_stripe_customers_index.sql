-- Follow-up to 0019: webhook handlers look up the owning producer +
-- client by stripe_customer_id; without this index they seq-scan.
CREATE INDEX IF NOT EXISTS "stripe_customers_customer_idx"
  ON "stripe_customers" ("stripe_customer_id");
