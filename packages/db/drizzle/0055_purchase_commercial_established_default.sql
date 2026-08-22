-- SK-255 follow-up: 0054 made "commercial_established_at" NOT NULL with no
-- default. Code that predates 0054 still inserts an accepted Purchase with only
-- "accepted_at", and for every non-imported Purchase the establishment time is
-- the Artist acceptance time by definition (0054 backfilled existing rows the
-- same way and "purchases_commercial_establishment_shape" still requires the
-- two to be equal). Fill the gap before insert so such inserts keep succeeding.
-- Imported Purchases keep "accepted_at" null and always supply the column, so
-- this default can never invent Artist acceptance evidence.

CREATE OR REPLACE FUNCTION "default_purchase_commercial_established_at"()
RETURNS trigger AS $function$
BEGIN
  NEW."commercial_established_at" := COALESCE(NEW."commercial_established_at", NEW."accepted_at");
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "purchases_default_commercial_established_at"
  BEFORE INSERT ON "purchases"
  FOR EACH ROW EXECUTE FUNCTION "default_purchase_commercial_established_at"();
