-- SK-96: freeze the verified recipient identity on every private offer.
-- Existing rows are backfilled from their producer-scoped client contact.

ALTER TABLE "private_offers"
  ADD COLUMN "recipient_email" text,
  ADD COLUMN "recipient_email_hash" text;

UPDATE "private_offers" AS offer
SET
  "recipient_email" = contact."email",
  "recipient_email_hash" = contact."email_hash"
FROM "client_contacts" AS contact
WHERE contact."id" = offer."client_contact_id"
  AND contact."producer_id" = offer."producer_id";

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "private_offers"
    WHERE "recipient_email" IS NULL OR "recipient_email_hash" IS NULL
  ) THEN
    RAISE EXCEPTION 'SKITZA_PRIVATE_OFFER_RECIPIENT_BACKFILL_FAILED';
  END IF;
END
$migration$;

ALTER TABLE "private_offers"
  ALTER COLUMN "recipient_email" SET NOT NULL,
  ALTER COLUMN "recipient_email_hash" SET NOT NULL,
  ADD CONSTRAINT "private_offers_recipient_email_hash_shape"
    CHECK ("recipient_email_hash" ~ '^[0-9a-f]{64}$');

CREATE INDEX "private_offers_recipient_status_expiry_idx"
  ON "private_offers" ("recipient_email_hash", "status", "expires_at");

CREATE OR REPLACE FUNCTION "skitza_guard_private_offer_recipient_identity"()
RETURNS trigger AS $function$
BEGIN
  IF NEW."recipient_email" IS DISTINCT FROM OLD."recipient_email"
    OR NEW."recipient_email_hash" IS DISTINCT FROM OLD."recipient_email_hash"
  THEN
    RAISE EXCEPTION 'SKITZA_PRIVATE_OFFER_RECIPIENT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "private_offers_recipient_identity_immutable"
BEFORE UPDATE OF "recipient_email", "recipient_email_hash" ON "private_offers"
FOR EACH ROW EXECUTE FUNCTION "skitza_guard_private_offer_recipient_identity"();
