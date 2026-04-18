-- Phase H.2 — add nullable CRM meta fields to `client_contacts`.
-- Producers fill these from /dashboard/clients. All three columns are
-- nullable so existing rows (and the implicit upsert paths — booking
-- confirmation, contract signing, artist form) continue to work
-- unchanged.
BEGIN;

ALTER TABLE "client_contacts" ADD COLUMN IF NOT EXISTS "tags" text[];
ALTER TABLE "client_contacts" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE "client_contacts" ADD COLUMN IF NOT EXISTS "referral_source" text;

COMMIT;
