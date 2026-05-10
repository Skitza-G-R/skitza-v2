-- Per-producer Tranzila terminal architecture. When set, payments route
-- to the producer's own terminal so funds flow directly to them. Null =
-- fall back to the master sandbox terminal (env TRANZILA_TERMINAL_NAME).
-- Provisioned manually by Skitza admin after the producer submits the
-- connection-request form on Settings → Integrations → Payments.
--
-- Idempotent — safe to re-run via /skitza-migrate.
BEGIN;

ALTER TABLE "producers" ADD COLUMN IF NOT EXISTS "tranzila_terminal_name" text;

COMMIT;
