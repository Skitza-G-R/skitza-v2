-- SK-73 — structured product royalty terms and immutable agreement snapshots.
-- Nullable columns preserve compatibility with products and requests created
-- before the commercial-terms editor shipped.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "royalty_terms" jsonb;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "agreement_text" text;

ALTER TABLE "purchase_requests"
  ADD COLUMN IF NOT EXISTS "royalty_terms_snapshot" jsonb;

ALTER TABLE "purchase_requests"
  ADD COLUMN IF NOT EXISTS "agreement_text_snapshot" text;
