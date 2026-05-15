-- 0012_client_contacts_phone.sql
-- Adds optional `phone` column to client_contacts to support the
-- New Client modal in the Clients & Projects v3 redesign (PR #117).
-- Nullable so existing rows are unaffected. Idempotent.

ALTER TABLE "client_contacts" ADD COLUMN IF NOT EXISTS "phone" text;
