-- SK-18 refactor — defer project creation to the Tranzila callback.
-- Original PR #147 inserted a `lead`-stage project at checkout with
-- depositPaid=false; abandoned carts left orphan rows in the producers'
-- project lists. We replace that with an "intent" row that holds the
-- materialization payload until Tranzila confirms; the project row is
-- only inserted in store.confirmAfterPayment, so projects only ever
-- exist in their paid state.

CREATE TABLE IF NOT EXISTS "store_purchase_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "producer_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "artist_user_id" text,
  "artist_email" text NOT NULL,
  "artist_name" text NOT NULL,
  "song_qty" integer,
  "unit_price_cents" integer,
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "payment_plan_kind" text,
  "package_name_snapshot" text NOT NULL,
  "session_count" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "consumed_at" timestamp with time zone
);

DO $$ BEGIN
  ALTER TABLE "store_purchase_intents"
    ADD CONSTRAINT "store_purchase_intents_producer_id_fk"
    FOREIGN KEY ("producer_id") REFERENCES "producers"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "store_purchase_intents"
    ADD CONSTRAINT "store_purchase_intents_product_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "products"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "store_purchase_intents_created_idx"
  ON "store_purchase_intents" ("created_at");
