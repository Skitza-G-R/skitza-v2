-- The removed /share/[token] system can leave a legacy NOT NULL column in
-- older environments even though it is absent from the current schema. No
-- current application code reads it. Drop it when present so paid purchases
-- can create their booking project without reviving the retired share flow.
-- Also freeze the total session credit while the product still exists; later
-- product edits must never change what an artist already bought.
ALTER TABLE "purchase_requests"
  ADD COLUMN IF NOT EXISTS "session_count_snapshot" integer;

-- Keep request-time credit frozen during a rolling deploy. Old application
-- instances do not name the new column, so their inserts arrive as NULL after
-- this migration. The trigger fills only that legacy shape; current code's
-- explicit snapshot always wins.
CREATE OR REPLACE FUNCTION "freeze_purchase_request_session_count"()
RETURNS trigger
LANGUAGE plpgsql
AS $freeze$
BEGIN
  IF NEW."session_count_snapshot" IS NULL AND NEW."product_id" IS NOT NULL THEN
    SELECT CASE
      WHEN "product"."session_count" = 0 THEN 0
      WHEN "product"."pricing_model" = 'per_song' THEN
        "product"."session_count" * GREATEST(COALESCE(NEW."song_qty", 1), 1)
      ELSE "product"."session_count"
    END
    INTO NEW."session_count_snapshot"
    FROM "products" AS "product"
    WHERE "product"."id" = NEW."product_id"
      AND "product"."producer_id" = NEW."producer_id";
  END IF;
  RETURN NEW;
END;
$freeze$;

DROP TRIGGER IF EXISTS "purchase_requests_freeze_session_count" ON "purchase_requests";
CREATE TRIGGER "purchase_requests_freeze_session_count"
  BEFORE INSERT OR UPDATE OF "product_id", "song_qty"
  ON "purchase_requests"
  FOR EACH ROW
  WHEN (NEW."session_count_snapshot" IS NULL)
  EXECUTE FUNCTION "freeze_purchase_request_session_count"();

-- Requests created by the previous app version cannot carry the new snapshot.
-- Freeze the best recoverable value at migration time while the referenced
-- product still exists. The producer predicate is deliberate tenant defense;
-- deleted products remain NULL and the application uses its documented
-- single-session legacy fallback.
UPDATE "purchase_requests" AS "request"
SET "session_count_snapshot" = CASE
  WHEN "product"."session_count" = 0 THEN 0
  WHEN "product"."pricing_model" = 'per_song' THEN
    "product"."session_count" * GREATEST(COALESCE("request"."song_qty", 1), 1)
  ELSE "product"."session_count"
END
FROM "products" AS "product"
WHERE "request"."session_count_snapshot" IS NULL
  AND "request"."product_id" = "product"."id"
  AND "request"."producer_id" = "product"."producer_id";

ALTER TABLE "projects"
  DROP COLUMN IF EXISTS "share_token_hash";
