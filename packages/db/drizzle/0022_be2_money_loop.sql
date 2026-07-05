-- BE-2 money loop (2026-07-05, handoff-4 wave W1)
-- 1. Widen purchase_request_status: 'approved' doubles as awaiting-payment;
--    'verifying' = first proof submitted (Gate 2); 'paid' = first payment
--    confirmed, sessions unlocked. Paid-in-full is derived from invoices.
ALTER TYPE "public"."purchase_request_status" ADD VALUE IF NOT EXISTS 'verifying';
ALTER TYPE "public"."purchase_request_status" ADD VALUE IF NOT EXISTS 'paid';

-- 2. Producer off-app payment details (bank transfer text + Bit phone).
ALTER TABLE "producers" ADD COLUMN IF NOT EXISTS "payment_details" jsonb NOT NULL DEFAULT '{}';

-- 3. Proof-of-payment columns on invoices: one invoice row per proof.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "purchase_request_id" uuid REFERENCES "purchase_requests"("id") ON DELETE SET NULL;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "proof_file_url" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "proof_note" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "rejection_note" text;
CREATE INDEX IF NOT EXISTS "invoices_purchase_request_idx" ON "invoices" ("purchase_request_id");

-- 4. Producer inbox event for Gate 2.
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'proof_submitted';
