-- SK-255: truthful imported-Purchase provenance, resumable row drafts, and
-- durable email-invitation delivery evidence.
--
-- Schema only. Existing accepted Purchases retain their exact acceptance
-- time and history. This migration creates no imported work, sends nothing,
-- and does not connect to or migrate a database by itself.

ALTER TABLE "purchases"
  DROP CONSTRAINT "purchases_source_link_shape",
  DROP CONSTRAINT "purchases_source_amount_shape",
  DROP CONSTRAINT "purchases_zero_total_activation_shape",
  DROP CONSTRAINT "purchases_lifecycle_timestamp_shape";

-- Rebuild both enums inside this one atomic migration. PostgreSQL does not
-- allow a value added with ALTER TYPE ... ADD VALUE to be used until that
-- transaction commits.
ALTER TYPE "purchase_source_kind"
  RENAME TO "purchase_source_kind_legacy";

CREATE TYPE "purchase_source_kind" AS ENUM (
  'store_product',
  'private_offer',
  'session_product',
  'paid_add_on',
  'no_charge_add_on',
  'imported_existing_work'
);

ALTER TABLE "purchases"
  ALTER COLUMN "source_kind" TYPE "purchase_source_kind"
  USING "source_kind"::text::"purchase_source_kind";

DROP TYPE "purchase_source_kind_legacy";

ALTER TYPE "purchase_installment_due_trigger"
  RENAME TO "purchase_installment_due_trigger_legacy";

CREATE TYPE "purchase_installment_due_trigger" AS ENUM (
  'acceptance',
  'producer_import',
  'monthly_anniversary',
  'artist_approval'
);

ALTER TABLE "purchase_installments"
  ALTER COLUMN "due_trigger" TYPE "purchase_installment_due_trigger"
  USING "due_trigger"::text::"purchase_installment_due_trigger";

DROP TYPE "purchase_installment_due_trigger_legacy";

ALTER TABLE "purchases"
  ADD COLUMN "commercial_established_at" timestamp with time zone;

-- Every existing Purchase was established through its existing Artist
-- acceptance. Preserve that meaning byte-for-byte before allowing imports to
-- leave accepted_at null. The existing immutable-snapshot trigger rejects all
-- updates to canceled Purchases, including this one-time additive backfill, so
-- disable only that exact trigger inside this atomic migration and restore it
-- immediately afterward. The existing deferred installment-schedule trigger
-- also has to be paused so this backfill does not leave a pending trigger event
-- that blocks the following ALTER TABLE. The backfill changes neither the
-- schedule nor its inputs. No application-visible state can observe either
-- trigger disabled.
ALTER TABLE "purchases"
  DISABLE TRIGGER "purchases_protect_commercial_snapshot";

ALTER TABLE "purchases"
  DISABLE TRIGGER "purchases_validate_installment_schedule";

UPDATE "purchases"
SET "commercial_established_at" = "accepted_at";

ALTER TABLE "purchases"
  ENABLE TRIGGER "purchases_protect_commercial_snapshot";

ALTER TABLE "purchases"
  ENABLE TRIGGER "purchases_validate_installment_schedule";

ALTER TABLE "purchases"
  ALTER COLUMN "commercial_established_at" SET NOT NULL,
  ALTER COLUMN "accepted_at" DROP NOT NULL,
  ADD CONSTRAINT "purchases_id_establishment_unique"
    UNIQUE ("id", "commercial_established_at"),
  ADD CONSTRAINT "purchases_zero_total_activation_shape" CHECK ((
    "total_cents" > 0
    OR (
      "lifecycle_status" IN ('active', 'canceled')
      AND "activated_at" = "commercial_established_at"
    )
  ) IS TRUE),
  ADD CONSTRAINT "purchases_lifecycle_timestamp_shape" CHECK ((
    (
      "lifecycle_status" = 'waiting_for_payment'
      AND "activated_at" IS NULL
      AND "canceled_at" IS NULL
    )
    OR (
      "lifecycle_status" = 'active'
      AND "activated_at" >= "commercial_established_at"
      AND "canceled_at" IS NULL
    )
    OR (
      "lifecycle_status" = 'canceled'
      AND (
        (
          "activated_at" IS NULL
          AND "canceled_at" >= "commercial_established_at"
        )
        OR (
          "activated_at" >= "commercial_established_at"
          AND "canceled_at" >= "activated_at"
        )
      )
    )
  ) IS TRUE),
  ADD CONSTRAINT "purchases_commercial_establishment_shape" CHECK ((
    (
      "source_kind"::text = 'imported_existing_work'
      AND "accepted_at" IS NULL
    )
    OR (
      "source_kind"::text <> 'imported_existing_work'
      AND "accepted_at" = "commercial_established_at"
    )
  ) IS TRUE),
  ADD CONSTRAINT "purchases_source_link_shape" CHECK ((
    (
      "source_kind"::text IN ('store_product', 'session_product')
      AND "product_id" IS NOT NULL
      AND "purchase_request_id" IS NOT NULL
      AND "private_offer_id" IS NULL
    )
    OR (
      "source_kind"::text = 'private_offer'
      AND "private_offer_id" IS NOT NULL
      AND "purchase_request_id" IS NULL
    )
    OR (
      "source_kind"::text IN ('paid_add_on', 'no_charge_add_on')
      AND (
        "product_id" IS NOT NULL
        OR "private_offer_id" IS NOT NULL
        OR "purchase_request_id" IS NOT NULL
      )
    )
    OR (
      "source_kind"::text = 'imported_existing_work'
      AND "product_id" IS NULL
      AND "private_offer_id" IS NULL
      AND "purchase_request_id" IS NULL
    )
  ) IS TRUE),
  ADD CONSTRAINT "purchases_source_amount_shape" CHECK ((
    (
      "source_kind"::text IN (
        'store_product',
        'session_product',
        'paid_add_on',
        'imported_existing_work'
      )
      AND "total_cents" > 0
    )
    OR (
      "source_kind"::text = 'no_charge_add_on'
      AND "total_cents" = 0
    )
    OR "source_kind"::text = 'private_offer'
  ) IS TRUE);

ALTER TABLE "producers"
  ADD CONSTRAINT "producers_id_clerk_user_unique"
  UNIQUE ("id", "clerk_user_id");

CREATE TABLE "purchase_import_attestations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purchase_id" uuid NOT NULL,
  "producer_id" uuid NOT NULL,
  "client_contact_id" uuid NOT NULL,
  "imported_by_clerk_user_id" text NOT NULL,
  "imported_snapshot" jsonb NOT NULL,
  "snapshot_digest" text NOT NULL,
  "imported_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_import_attestations_purchase_unique"
    UNIQUE ("purchase_id"),
  CONSTRAINT "purchase_import_attestations_purchase_owner_fk"
    FOREIGN KEY ("purchase_id", "producer_id", "client_contact_id")
    REFERENCES "purchases" ("id", "producer_id", "client_contact_id")
    ON DELETE RESTRICT,
  CONSTRAINT "purchase_import_attestations_purchase_snapshot_fk"
    FOREIGN KEY ("purchase_id", "snapshot_digest")
    REFERENCES "purchases" ("id", "snapshot_digest")
    ON DELETE RESTRICT,
  CONSTRAINT "purchase_import_attestations_established_at_fk"
    FOREIGN KEY ("purchase_id", "imported_at")
    REFERENCES "purchases" ("id", "commercial_established_at")
    ON DELETE RESTRICT,
  CONSTRAINT "purchase_import_attestations_importing_producer_fk"
    FOREIGN KEY ("producer_id", "imported_by_clerk_user_id")
    REFERENCES "producers" ("id", "clerk_user_id")
    ON DELETE RESTRICT,
  CONSTRAINT "purchase_import_attestations_actor_shape"
    CHECK (NULLIF(btrim("imported_by_clerk_user_id"), '') IS NOT NULL)
);

CREATE TYPE "active_work_import_batch_status" AS ENUM (
  'draft',
  'in_progress',
  'completed'
);

CREATE TABLE "active_work_import_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "producer_id" uuid NOT NULL,
  "operation_key" text NOT NULL,
  "created_by_clerk_user_id" text NOT NULL,
  "status" "active_work_import_batch_status" DEFAULT 'draft' NOT NULL,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "active_work_import_batches_operation_unique"
    UNIQUE ("producer_id", "operation_key"),
  CONSTRAINT "active_work_import_batches_id_producer_unique"
    UNIQUE ("id", "producer_id"),
  CONSTRAINT "active_work_import_batches_producer_fk"
    FOREIGN KEY ("producer_id") REFERENCES "producers" ("id")
    ON DELETE RESTRICT,
  CONSTRAINT "active_work_import_batches_creating_producer_fk"
    FOREIGN KEY ("producer_id", "created_by_clerk_user_id")
    REFERENCES "producers" ("id", "clerk_user_id")
    ON DELETE RESTRICT,
  CONSTRAINT "active_work_import_batches_operation_shape" CHECK (
    NULLIF(btrim("operation_key"), '') IS NOT NULL
    AND char_length("operation_key") <= 200
    AND NULLIF(btrim("created_by_clerk_user_id"), '') IS NOT NULL
  ),
  CONSTRAINT "active_work_import_batches_state_shape" CHECK ((
    (
      "status" = 'completed'
      AND "completed_at" IS NOT NULL
    )
    OR (
      "status" <> 'completed'
      AND "completed_at" IS NULL
    )
  ) IS TRUE),
  CONSTRAINT "active_work_import_batches_timestamp_shape" CHECK (
    "updated_at" >= "created_at"
    AND ("completed_at" IS NULL OR "completed_at" >= "created_at")
  )
);

CREATE INDEX "active_work_import_batches_status_updated_idx"
  ON "active_work_import_batches" ("producer_id", "status", "updated_at", "id");

-- Reserve one immutable finish-setup intent before invitations or reminder
-- changes begin. operation_digest binds a kind/version discriminator,
-- batchId, expectedSetupDigest, sorted deduplicated Client IDs, and sorted
-- deduplicated installment IDs.
CREATE TABLE "active_work_import_setup_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "producer_id" uuid NOT NULL,
  "batch_id" uuid NOT NULL,
  "operation_key" text NOT NULL,
  "operation_digest" text NOT NULL,
  "requested_by_clerk_user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "active_work_import_setup_operations_operation_unique"
    UNIQUE ("producer_id", "batch_id", "operation_key"),
  CONSTRAINT "active_work_import_setup_operations_batch_producer_fk"
    FOREIGN KEY ("batch_id", "producer_id")
    REFERENCES "active_work_import_batches" ("id", "producer_id")
    ON DELETE RESTRICT,
  CONSTRAINT "active_work_import_setup_operations_requesting_producer_fk"
    FOREIGN KEY ("producer_id", "requested_by_clerk_user_id")
    REFERENCES "producers" ("id", "clerk_user_id")
    ON DELETE RESTRICT,
  CONSTRAINT "active_work_import_setup_operations_operation_shape" CHECK (
    NULLIF(btrim("operation_key"), '') IS NOT NULL
    AND char_length("operation_key") <= 200
    AND "operation_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND NULLIF(btrim("requested_by_clerk_user_id"), '') IS NOT NULL
    AND char_length("requested_by_clerk_user_id") <= 200
  ),
  CONSTRAINT "active_work_import_setup_operations_timestamp_shape"
    CHECK (isfinite("created_at"))
);

CREATE TABLE "active_work_import_rows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "producer_id" uuid NOT NULL,
  "operation_key" text NOT NULL,
  "draft_revision" integer DEFAULT 1 NOT NULL,
  "draft_payload" jsonb NOT NULL,
  "creation_digest" text,
  "created_client_contact_id" uuid,
  "created_project_id" uuid,
  "created_purchase_id" uuid,
  "materialized_at" timestamp with time zone,
  "last_attempted_at" timestamp with time zone,
  "last_error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "active_work_import_rows_operation_unique"
    UNIQUE ("producer_id", "operation_key"),
  CONSTRAINT "active_work_import_rows_id_producer_unique"
    UNIQUE ("id", "producer_id"),
  CONSTRAINT "active_work_import_rows_batch_producer_fk"
    FOREIGN KEY ("batch_id", "producer_id")
    REFERENCES "active_work_import_batches" ("id", "producer_id")
    ON DELETE RESTRICT,
  CONSTRAINT "active_work_import_rows_client_producer_fk"
    FOREIGN KEY ("created_client_contact_id", "producer_id")
    REFERENCES "client_contacts" ("id", "producer_id")
    ON DELETE RESTRICT,
  CONSTRAINT "active_work_import_rows_project_owner_fk"
    FOREIGN KEY (
      "created_project_id",
      "producer_id",
      "created_client_contact_id"
    )
    REFERENCES "projects" ("id", "producer_id", "client_contact_id")
    ON DELETE RESTRICT,
  CONSTRAINT "active_work_import_rows_purchase_owner_fk"
    FOREIGN KEY (
      "created_purchase_id",
      "created_project_id",
      "producer_id",
      "created_client_contact_id"
    )
    REFERENCES "purchases" (
      "id",
      "project_id",
      "producer_id",
      "client_contact_id"
    )
    ON DELETE RESTRICT,
  CONSTRAINT "active_work_import_rows_operation_shape" CHECK (
    NULLIF(btrim("operation_key"), '') IS NOT NULL
    AND char_length("operation_key") <= 200
  ),
  CONSTRAINT "active_work_import_rows_draft_shape" CHECK (
    "draft_revision" > 0
    AND jsonb_typeof("draft_payload") = 'object'
  ),
  CONSTRAINT "active_work_import_rows_result_shape" CHECK ((
    (
      "created_client_contact_id" IS NULL
      AND "created_project_id" IS NULL
      AND "created_purchase_id" IS NULL
      AND "creation_digest" IS NULL
      AND "materialized_at" IS NULL
    )
    OR (
      "created_client_contact_id" IS NOT NULL
      AND "created_project_id" IS NOT NULL
      AND "created_purchase_id" IS NOT NULL
      AND "creation_digest" ~ '^sha256:[0-9a-f]{64}$'
      AND "materialized_at" IS NOT NULL
      AND "last_attempted_at" IS NOT NULL
      AND "last_error_code" IS NULL
    )
  ) IS TRUE),
  CONSTRAINT "active_work_import_rows_failure_shape" CHECK (
    "last_error_code" IS NULL
    OR (
      NULLIF(btrim("last_error_code"), '') IS NOT NULL
      AND "last_attempted_at" IS NOT NULL
    )
  ),
  CONSTRAINT "active_work_import_rows_timestamp_shape" CHECK (
    "updated_at" >= "created_at"
    AND ("materialized_at" IS NULL OR "materialized_at" >= "created_at")
    AND ("last_attempted_at" IS NULL OR "last_attempted_at" >= "created_at")
  )
);

CREATE UNIQUE INDEX "active_work_import_rows_created_project_unique"
  ON "active_work_import_rows" ("created_project_id")
  WHERE "created_project_id" IS NOT NULL;

CREATE UNIQUE INDEX "active_work_import_rows_created_purchase_unique"
  ON "active_work_import_rows" ("created_purchase_id")
  WHERE "created_purchase_id" IS NOT NULL;

CREATE INDEX "active_work_import_rows_batch_updated_idx"
  ON "active_work_import_rows" ("batch_id", "updated_at", "id");

CREATE TYPE "client_invitation_email_delivery_status" AS ENUM (
  'reserved',
  'sending',
  'provider_accepted',
  'failed',
  'dedupe_expired'
);

CREATE TABLE "client_invitation_email_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_contact_id" uuid NOT NULL,
  "producer_id" uuid NOT NULL,
  "operation_key" text NOT NULL,
  "operation_digest" text NOT NULL,
  "recipient_email" text NOT NULL,
  "recipient_email_hash" text NOT NULL,
  "message_snapshot" jsonb NOT NULL,
  "requested_by_clerk_user_id" text NOT NULL,
  "provider_idempotency_key" text NOT NULL,
  "status" "client_invitation_email_delivery_status" DEFAULT 'reserved' NOT NULL,
  "claim_token" text,
  "claim_until" timestamp with time zone,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "first_attempt_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone,
  "provider_dedupe_expires_at" timestamp with time zone,
  "provider_message_id" text,
  "provider_accepted_at" timestamp with time zone,
  "last_failed_at" timestamp with time zone,
  "failure_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_invitation_email_deliveries_operation_unique"
    UNIQUE ("producer_id", "client_contact_id", "operation_key"),
  CONSTRAINT "client_invitation_email_deliveries_provider_idempotency_unique"
    UNIQUE ("provider_idempotency_key"),
  CONSTRAINT "client_invitation_email_deliveries_client_producer_fk"
    FOREIGN KEY ("client_contact_id", "producer_id")
    REFERENCES "client_contacts" ("id", "producer_id")
    ON DELETE RESTRICT,
  CONSTRAINT "client_invitation_email_deliveries_requesting_producer_fk"
    FOREIGN KEY ("producer_id", "requested_by_clerk_user_id")
    REFERENCES "producers" ("id", "clerk_user_id")
    ON DELETE RESTRICT,
  CONSTRAINT "client_invitation_email_deliveries_operation_shape" CHECK (
    NULLIF(btrim("operation_key"), '') IS NOT NULL
    AND char_length("operation_key") <= 200
    AND "operation_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND NULLIF(btrim("provider_idempotency_key"), '') IS NOT NULL
    AND char_length("provider_idempotency_key") <= 256
  ),
  CONSTRAINT "client_invitation_email_deliveries_recipient_shape" CHECK ((
    "recipient_email_hash" ~ '^[0-9a-f]{64}$'
    AND NULLIF(btrim("recipient_email"), '') IS NOT NULL
    AND "message_snapshot"->>'to' = "recipient_email"
    AND NULLIF(btrim("message_snapshot"->>'inviteUrl'), '') IS NOT NULL
    AND NULLIF(btrim("requested_by_clerk_user_id"), '') IS NOT NULL
  ) IS TRUE),
  CONSTRAINT "client_invitation_email_deliveries_attempt_shape" CHECK ((
    (
      "attempt_count" = 0
      AND "first_attempt_at" IS NULL
      AND "last_attempt_at" IS NULL
      AND "provider_dedupe_expires_at" IS NULL
    )
    OR (
      "attempt_count" > 0
      AND "first_attempt_at" IS NOT NULL
      AND "last_attempt_at" IS NOT NULL
      AND "provider_dedupe_expires_at" IS NOT NULL
    )
  ) IS TRUE),
  CONSTRAINT "client_invitation_email_deliveries_state_shape" CHECK ((
    (
      "status" = 'reserved'
      AND "claim_token" IS NULL
      AND "claim_until" IS NULL
      AND "attempt_count" = 0
      AND "provider_message_id" IS NULL
      AND "provider_accepted_at" IS NULL
      AND "last_failed_at" IS NULL
      AND "failure_code" IS NULL
    )
    OR (
      "status" = 'sending'
      AND NULLIF(btrim("claim_token"), '') IS NOT NULL
      AND "claim_until" IS NOT NULL
      AND "attempt_count" > 0
      AND "provider_message_id" IS NULL
      AND "provider_accepted_at" IS NULL
      AND "failure_code" IS NULL
    )
    OR (
      "status" = 'provider_accepted'
      AND "claim_token" IS NULL
      AND "claim_until" IS NULL
      AND "attempt_count" > 0
      AND NULLIF(btrim("provider_message_id"), '') IS NOT NULL
      AND "provider_accepted_at" IS NOT NULL
      AND "failure_code" IS NULL
    )
    OR (
      "status" = 'failed'
      AND "claim_token" IS NULL
      AND "claim_until" IS NULL
      AND "attempt_count" > 0
      AND "provider_message_id" IS NULL
      AND "provider_accepted_at" IS NULL
      AND "last_failed_at" IS NOT NULL
      AND NULLIF(btrim("failure_code"), '') IS NOT NULL
    )
    OR (
      "status" = 'dedupe_expired'
      AND "claim_token" IS NULL
      AND "claim_until" IS NULL
      AND "attempt_count" > 0
      AND "provider_message_id" IS NULL
      AND "provider_accepted_at" IS NULL
    )
  ) IS TRUE),
  CONSTRAINT "client_invitation_email_deliveries_timestamp_shape" CHECK (
    "updated_at" >= "created_at"
    AND ("claim_until" IS NULL OR "claim_until" >= "created_at")
    AND ("first_attempt_at" IS NULL OR "first_attempt_at" >= "created_at")
    AND ("last_attempt_at" IS NULL OR "last_attempt_at" >= "first_attempt_at")
    AND (
      "provider_dedupe_expires_at" IS NULL
      OR "provider_dedupe_expires_at" > "first_attempt_at"
    )
    AND (
      "provider_accepted_at" IS NULL
      OR "provider_accepted_at" >= "first_attempt_at"
    )
    AND ("last_failed_at" IS NULL OR "last_failed_at" >= "first_attempt_at")
  )
);

CREATE INDEX "client_invitation_email_deliveries_claim_idx"
  ON "client_invitation_email_deliveries" ("status", "claim_until", "id");

CREATE INDEX "client_invitation_email_deliveries_producer_updated_idx"
  ON "client_invitation_email_deliveries" ("producer_id", "updated_at", "id");

CREATE INDEX "client_invitation_email_deliveries_client_accepted_idx"
  ON "client_invitation_email_deliveries" (
    "client_contact_id",
    "provider_accepted_at",
    "id"
  );

CREATE OR REPLACE FUNCTION "validate_purchase_source_links"()
RETURNS trigger AS $function$
BEGIN
  IF NEW."source_kind"::text IN ('store_product', 'session_product') THEN
    PERFORM 1
    FROM "purchase_requests" AS source_request
    WHERE source_request."id" = NEW."purchase_request_id"
      AND source_request."product_id" = NEW."product_id"
      AND source_request."project_id" = NEW."project_id"
      AND source_request."producer_id" = NEW."producer_id"
      AND source_request."client_contact_id" = NEW."client_contact_id"
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_PURCHASE_SOURCE_LINK_MISMATCH';
    END IF;
  ELSIF NEW."source_kind"::text = 'private_offer' THEN
    PERFORM 1
    FROM "private_offers" AS source_offer
    WHERE source_offer."id" = NEW."private_offer_id"
      AND source_offer."target_project_id" = NEW."project_id"
      AND source_offer."product_id" IS NOT DISTINCT FROM NEW."product_id"
      AND source_offer."producer_id" = NEW."producer_id"
      AND source_offer."client_contact_id" = NEW."client_contact_id"
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_PRIVATE_OFFER_SOURCE_MISMATCH';
    END IF;
  ELSIF NEW."source_kind"::text = 'imported_existing_work' THEN
    IF NEW."product_id" IS NOT NULL
      OR NEW."private_offer_id" IS NOT NULL
      OR NEW."purchase_request_id" IS NOT NULL
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_IMPORTED_PURCHASE_SOURCE_MUST_BE_EMPTY';
    END IF;
  ELSE
    IF NEW."product_id" IS NOT NULL THEN
      PERFORM 1
      FROM "products" AS source_product
      WHERE source_product."id" = NEW."product_id"
        AND source_product."producer_id" = NEW."producer_id"
      FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'SKITZA_PURCHASE_SOURCE_LINK_MISMATCH';
      END IF;
    END IF;

    IF NEW."private_offer_id" IS NOT NULL THEN
      PERFORM 1
      FROM "private_offers" AS source_offer
      WHERE source_offer."id" = NEW."private_offer_id"
        AND source_offer."target_project_id" = NEW."project_id"
        AND source_offer."producer_id" = NEW."producer_id"
        AND source_offer."client_contact_id" = NEW."client_contact_id"
        AND (
          NEW."product_id" IS NULL
          OR source_offer."product_id" IS NULL
          OR source_offer."product_id" = NEW."product_id"
        )
      FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'SKITZA_PURCHASE_SOURCE_LINK_MISMATCH';
      END IF;
    END IF;

    IF NEW."purchase_request_id" IS NOT NULL THEN
      PERFORM 1
      FROM "purchase_requests" AS source_request
      WHERE source_request."id" = NEW."purchase_request_id"
        AND source_request."project_id" = NEW."project_id"
        AND source_request."producer_id" = NEW."producer_id"
        AND source_request."client_contact_id" = NEW."client_contact_id"
        AND (
          NEW."product_id" IS NULL
          OR source_request."product_id" = NEW."product_id"
        )
      FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'SKITZA_PURCHASE_SOURCE_LINK_MISMATCH';
      END IF;
    END IF;

    IF NEW."product_id" IS NULL
      AND NEW."private_offer_id" IS NOT NULL
      AND NEW."purchase_request_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "private_offers" AS source_offer
        JOIN "purchase_requests" AS source_request
          ON source_request."id" = NEW."purchase_request_id"
        WHERE source_offer."id" = NEW."private_offer_id"
          AND (
            source_offer."product_id" IS NULL
            OR source_offer."product_id" = source_request."product_id"
          )
      )
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_PURCHASE_SOURCE_LINK_MISMATCH';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "protect_purchase_commercial_snapshot"()
RETURNS trigger AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_DELETE_FORBIDDEN';
  END IF;

  IF ROW(
    OLD."id",
    OLD."producer_id",
    OLD."project_id",
    OLD."client_contact_id",
    OLD."product_id",
    OLD."private_offer_id",
    OLD."purchase_request_id",
    OLD."source_kind",
    OLD."operation_key",
    OLD."operation_digest",
    OLD."ref_number",
    OLD."payment_plan_kind",
    OLD."snapshot_version",
    OLD."snapshot_digest",
    OLD."commercial_snapshot",
    OLD."subtotal_cents",
    OLD."tax_cents",
    OLD."total_cents",
    OLD."currency",
    OLD."accepted_at",
    OLD."commercial_established_at",
    OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id",
    NEW."producer_id",
    NEW."project_id",
    NEW."client_contact_id",
    NEW."product_id",
    NEW."private_offer_id",
    NEW."purchase_request_id",
    NEW."source_kind",
    NEW."operation_key",
    NEW."operation_digest",
    NEW."ref_number",
    NEW."payment_plan_kind",
    NEW."snapshot_version",
    NEW."snapshot_digest",
    NEW."commercial_snapshot",
    NEW."subtotal_cents",
    NEW."tax_cents",
    NEW."total_cents",
    NEW."currency",
    NEW."accepted_at",
    NEW."commercial_established_at",
    NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_COMMERCIAL_SNAPSHOT_IMMUTABLE';
  END IF;

  IF OLD."lifecycle_status" = 'canceled' THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_CANCELED_TERMINAL';
  END IF;

  IF OLD."lifecycle_status" = NEW."lifecycle_status" THEN
    IF ROW(OLD."activated_at", OLD."canceled_at") IS DISTINCT FROM
      ROW(NEW."activated_at", NEW."canceled_at")
    THEN
      RAISE EXCEPTION 'SKITZA_PURCHASE_LIFECYCLE_TIMESTAMPS_IMMUTABLE';
    END IF;
  ELSIF NOT (
    (
      OLD."lifecycle_status" = 'waiting_for_payment'
      AND NEW."lifecycle_status" IN ('active', 'canceled')
    )
    OR (
      OLD."lifecycle_status" = 'active'
      AND NEW."lifecycle_status" = 'canceled'
    )
  ) THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_LIFECYCLE_TRANSITION_FORBIDDEN';
  ELSIF OLD."lifecycle_status" = 'waiting_for_payment'
    AND NEW."lifecycle_status" = 'canceled'
    AND NEW."activated_at" IS NOT NULL
  THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_CANCELED_BEFORE_ACTIVATION';
  ELSIF OLD."activated_at" IS NOT NULL
    AND NEW."activated_at" IS DISTINCT FROM OLD."activated_at"
  THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_ACTIVATION_TIME_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_purchase_acceptance"()
RETURNS trigger AS $function$
BEGIN
  PERFORM 1
  FROM "purchases"
  WHERE "id" = NEW."purchase_id"
    AND "producer_id" = NEW."producer_id"
    AND "client_contact_id" = NEW."client_contact_id"
    AND "source_kind"::text <> 'imported_existing_work'
    AND "snapshot_digest" = NEW."snapshot_digest"
    AND "commercial_snapshot" = NEW."accepted_snapshot"
    AND "accepted_at" = NEW."accepted_at"
    AND "commercial_established_at" = NEW."accepted_at"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'SKITZA_ACCEPTANCE_MUST_MATCH_PURCHASE_SNAPSHOT';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_purchase_import_attestation"()
RETURNS trigger AS $function$
BEGIN
  PERFORM 1
  FROM "purchases"
  WHERE "id" = NEW."purchase_id"
    AND "producer_id" = NEW."producer_id"
    AND "client_contact_id" = NEW."client_contact_id"
    AND "source_kind"::text = 'imported_existing_work'
    AND "accepted_at" IS NULL
    AND "snapshot_digest" = NEW."snapshot_digest"
    AND "commercial_snapshot" = NEW."imported_snapshot"
    AND "commercial_established_at" = NEW."imported_at"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'SKITZA_IMPORT_ATTESTATION_MUST_MATCH_PURCHASE_SNAPSHOT';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "purchase_import_attestations_validate_purchase"
  BEFORE INSERT ON "purchase_import_attestations"
  FOR EACH ROW EXECUTE FUNCTION "validate_purchase_import_attestation"();

CREATE TRIGGER "purchase_import_attestations_append_only"
  BEFORE UPDATE OR DELETE ON "purchase_import_attestations"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

CREATE OR REPLACE FUNCTION "reject_purchase_installment_after_acceptance"()
RETURNS trigger AS $function$
BEGIN
  PERFORM 1
  FROM "purchases"
  WHERE "id" = NEW."purchase_id"
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM "purchase_acceptances"
    WHERE "purchase_id" = NEW."purchase_id"
  ) OR EXISTS (
    SELECT 1
    FROM "purchase_import_attestations"
    WHERE "purchase_id" = NEW."purchase_id"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'SKITZA_PURCHASE_INSTALLMENT_SCHEDULE_SEALED';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

-- Existing accepted Purchase installments keep the column's default true.
-- An imported schedule must explicitly insert false; a later deliberate
-- UPDATE may enable reminders for a selected unpaid installment.
CREATE FUNCTION "require_imported_purchase_reminders_off"()
RETURNS trigger AS $function$
BEGIN
  IF NEW."reminders_enabled" AND EXISTS (
    SELECT 1
    FROM "purchases"
    WHERE "id" = NEW."purchase_id"
      AND "producer_id" = NEW."producer_id"
      AND "source_kind"::text = 'imported_existing_work'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'SKITZA_IMPORTED_INSTALLMENT_REMINDERS_MUST_START_OFF';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "purchase_installments_import_reminders_default"
  BEFORE INSERT ON "purchase_installments"
  FOR EACH ROW EXECUTE FUNCTION "require_imported_purchase_reminders_off"();

CREATE OR REPLACE FUNCTION "validate_purchase_installment_schedule"()
RETURNS trigger AS $function$
DECLARE
  target_purchase_id uuid;
  purchase_total_cents integer;
  purchase_plan_kind text;
  purchase_source_kind text;
  purchase_snapshot jsonb;
  purchase_established_at timestamp with time zone;
  purchase_accepted_at timestamp with time zone;
  expected_installment_count integer;
  base_installment_amount integer;
  installment_remainder integer;
  monthly_installments_text text;
  installment_count integer;
  installment_sum bigint;
  minimum_position integer;
  maximum_position integer;
  activation_installment_count integer;
  invalid_amount_count integer;
  invalid_trigger_count integer;
  invalid_first_anchor_count integer;
BEGIN
  IF TG_TABLE_NAME = 'purchases' THEN
    target_purchase_id := COALESCE(NEW."id", OLD."id");
  ELSIF TG_OP = 'DELETE' THEN
    target_purchase_id := OLD."purchase_id";
  ELSE
    target_purchase_id := NEW."purchase_id";
  END IF;

  SELECT
    "total_cents",
    "payment_plan_kind"::text,
    "source_kind"::text,
    "commercial_snapshot",
    "commercial_established_at",
    "accepted_at"
  INTO
    purchase_total_cents,
    purchase_plan_kind,
    purchase_source_kind,
    purchase_snapshot,
    purchase_established_at,
    purchase_accepted_at
  FROM "purchases"
  WHERE "id" = target_purchase_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF purchase_total_cents = 0 THEN
    expected_installment_count := 0;
  ELSIF purchase_plan_kind = 'full' THEN
    expected_installment_count := 1;
  ELSIF purchase_plan_kind = 'split_50_50' THEN
    expected_installment_count := 2;
  ELSIF purchase_plan_kind = 'monthly' THEN
    monthly_installments_text :=
      purchase_snapshot->'selectedPaymentPlan'->>'installments';
    IF monthly_installments_text IS NULL
      OR monthly_installments_text !~ '^[0-9]+$'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_PURCHASE_INSTALLMENT_SCHEDULE_INVALID';
    END IF;
    expected_installment_count := monthly_installments_text::integer;
    IF expected_installment_count < 2 OR expected_installment_count > 12 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_PURCHASE_INSTALLMENT_SCHEDULE_INVALID';
    END IF;
  ELSE
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'SKITZA_PURCHASE_INSTALLMENT_SCHEDULE_INVALID';
  END IF;

  IF expected_installment_count > 0 THEN
    base_installment_amount := purchase_total_cents / expected_installment_count;
    installment_remainder :=
      purchase_total_cents - (base_installment_amount * expected_installment_count);
  END IF;

  SELECT
    count(*)::integer,
    COALESCE(sum("amount_cents"), 0)::bigint,
    min("position"),
    max("position"),
    count(*) FILTER (WHERE "required_for_activation")::integer,
    count(*) FILTER (
      WHERE "amount_cents" <>
        base_installment_amount
        + CASE WHEN "position" = 1 THEN installment_remainder ELSE 0 END
    )::integer,
    count(*) FILTER (
      WHERE
        (
          "position" = 1
          AND (
            NOT "required_for_activation"
            OR (
              purchase_source_kind = 'imported_existing_work'
              AND "due_trigger"::text <> 'producer_import'
            )
            OR (
              purchase_source_kind <> 'imported_existing_work'
              AND "due_trigger"::text <> 'acceptance'
            )
          )
        )
        OR (
          "position" > 1
          AND (
            "required_for_activation"
            OR (
              purchase_plan_kind = 'split_50_50'
              AND "due_trigger"::text <> 'artist_approval'
            )
            OR (
              purchase_plan_kind = 'monthly'
              AND "due_trigger"::text <> 'monthly_anniversary'
            )
          )
        )
    )::integer,
    count(*) FILTER (
      WHERE "position" = 1
        AND (
          (
            purchase_source_kind = 'imported_existing_work'
            AND (
              "due_at" IS DISTINCT FROM purchase_established_at
              OR "triggered_at" IS DISTINCT FROM purchase_established_at
            )
          )
          OR (
            purchase_source_kind <> 'imported_existing_work'
            AND (
              "due_at" IS DISTINCT FROM purchase_accepted_at
              OR "triggered_at" IS DISTINCT FROM purchase_accepted_at
            )
          )
        )
    )::integer
  INTO
    installment_count,
    installment_sum,
    minimum_position,
    maximum_position,
    activation_installment_count,
    invalid_amount_count,
    invalid_trigger_count,
    invalid_first_anchor_count
  FROM "purchase_installments"
  WHERE "purchase_id" = target_purchase_id;

  IF (
    purchase_total_cents = 0
    AND installment_count <> 0
  ) OR (
    purchase_total_cents > 0
    AND (
      installment_count <> expected_installment_count
      OR installment_sum <> purchase_total_cents::bigint
      OR minimum_position <> 1
      OR maximum_position <> expected_installment_count
      OR activation_installment_count <> 1
      OR invalid_amount_count <> 0
      OR invalid_trigger_count <> 0
      OR invalid_first_anchor_count <> 0
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'SKITZA_PURCHASE_INSTALLMENT_SCHEDULE_INVALID';
  END IF;

  RETURN NULL;
END;
$function$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "purchase_import_attestations_validate_schedule"
  AFTER INSERT OR UPDATE OR DELETE ON "purchase_import_attestations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_purchase_installment_schedule"();

-- Exactly one truthful establishment record must exist at transaction end.
-- Accepted sources retain one Artist acceptance and no import attestation;
-- imported sources retain one Producer attestation and no Artist acceptance.
CREATE FUNCTION "validate_purchase_commercial_establishment"()
RETURNS trigger AS $function$
DECLARE
  target_purchase_id uuid;
  target_source_kind text;
  target_accepted_at timestamp with time zone;
  target_established_at timestamp with time zone;
  acceptance_count integer;
  import_attestation_count integer;
BEGIN
  IF TG_TABLE_NAME = 'purchases' THEN
    target_purchase_id := COALESCE(NEW."id", OLD."id");
  ELSIF TG_OP = 'DELETE' THEN
    target_purchase_id := OLD."purchase_id";
  ELSE
    target_purchase_id := NEW."purchase_id";
  END IF;

  SELECT "source_kind"::text, "accepted_at", "commercial_established_at"
  INTO target_source_kind, target_accepted_at, target_established_at
  FROM "purchases"
  WHERE "id" = target_purchase_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::integer
  INTO acceptance_count
  FROM "purchase_acceptances"
  WHERE "purchase_id" = target_purchase_id;

  SELECT count(*)::integer
  INTO import_attestation_count
  FROM "purchase_import_attestations"
  WHERE "purchase_id" = target_purchase_id;

  IF target_source_kind = 'imported_existing_work' THEN
    IF target_accepted_at IS NOT NULL
      OR acceptance_count <> 0
      OR import_attestation_count <> 1
      OR NOT EXISTS (
        SELECT 1
        FROM "purchase_import_attestations" AS attestation
        WHERE attestation."purchase_id" = target_purchase_id
          AND attestation."imported_at" = target_established_at
      )
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SKITZA_IMPORTED_PURCHASE_REQUIRES_PRODUCER_ATTESTATION_ONLY';
    END IF;
  ELSIF target_accepted_at IS NULL
    OR target_accepted_at <> target_established_at
    OR acceptance_count <> 1
    OR import_attestation_count <> 0
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'SKITZA_ACCEPTED_PURCHASE_REQUIRES_ARTIST_ACCEPTANCE_ONLY';
  END IF;

  RETURN NULL;
END;
$function$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "purchases_validate_commercial_establishment"
  AFTER INSERT OR UPDATE OR DELETE ON "purchases"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_purchase_commercial_establishment"();

CREATE CONSTRAINT TRIGGER "purchase_acceptances_validate_establishment"
  AFTER INSERT OR UPDATE OR DELETE ON "purchase_acceptances"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_purchase_commercial_establishment"();

CREATE CONSTRAINT TRIGGER "purchase_import_attestations_validate_establishment"
  AFTER INSERT OR UPDATE OR DELETE ON "purchase_import_attestations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_purchase_commercial_establishment"();

-- Existing rows must already satisfy the accepted half of the new exclusive
-- provenance contract. Fail closed instead of fabricating missing evidence.
DO $audit$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchases" AS purchase
    WHERE purchase."source_kind"::text = 'imported_existing_work'
      OR purchase."accepted_at" IS NULL
      OR purchase."commercial_established_at" <> purchase."accepted_at"
      OR (
        SELECT count(*)
        FROM "purchase_acceptances" AS acceptance
        WHERE acceptance."purchase_id" = purchase."id"
      ) <> 1
      OR EXISTS (
        SELECT 1
        FROM "purchase_import_attestations" AS attestation
        WHERE attestation."purchase_id" = purchase."id"
      )
  ) THEN
    RAISE EXCEPTION 'SKITZA_EXISTING_PURCHASE_ESTABLISHMENT_INVALID';
  END IF;
END;
$audit$;

CREATE FUNCTION "protect_active_work_import_batch"()
RETURNS trigger AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1
      FROM "active_work_import_rows"
      WHERE "batch_id" = OLD."id"
        AND "producer_id" = OLD."producer_id"
        AND "materialized_at" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'SKITZA_ACTIVE_WORK_CREATED_BATCH_DELETE_FORBIDDEN';
    END IF;
    RETURN OLD;
  END IF;

  IF ROW(
    OLD."id",
    OLD."producer_id",
    OLD."operation_key",
    OLD."created_by_clerk_user_id",
    OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id",
    NEW."producer_id",
    NEW."operation_key",
    NEW."created_by_clerk_user_id",
    NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_ACTIVE_WORK_BATCH_IDENTITY_IMMUTABLE';
  END IF;

  IF OLD."status" = 'completed' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'SKITZA_ACTIVE_WORK_BATCH_COMPLETED_IMMUTABLE';
  END IF;

  IF OLD."status" <> NEW."status" AND NOT (
    (
      OLD."status" = 'draft'
      AND NEW."status" IN ('in_progress', 'completed')
    )
    OR (
      OLD."status" = 'in_progress'
      AND NEW."status" = 'completed'
    )
  ) THEN
    RAISE EXCEPTION 'SKITZA_ACTIVE_WORK_BATCH_STATUS_TRANSITION_FORBIDDEN';
  END IF;

  IF OLD."completed_at" IS NOT NULL
    AND NEW."completed_at" IS DISTINCT FROM OLD."completed_at"
  THEN
    RAISE EXCEPTION 'SKITZA_ACTIVE_WORK_BATCH_COMPLETION_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "active_work_import_batches_guard_mutation"
  BEFORE UPDATE OR DELETE ON "active_work_import_batches"
  FOR EACH ROW EXECUTE FUNCTION "protect_active_work_import_batch"();

CREATE TRIGGER "active_work_import_setup_operations_append_only"
  BEFORE UPDATE OR DELETE ON "active_work_import_setup_operations"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

CREATE FUNCTION "protect_active_work_import_row"()
RETURNS trigger AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."materialized_at" IS NOT NULL THEN
      RAISE EXCEPTION 'SKITZA_ACTIVE_WORK_CREATED_ROW_DELETE_FORBIDDEN';
    END IF;
    RETURN OLD;
  END IF;

  IF ROW(
    OLD."id",
    OLD."batch_id",
    OLD."producer_id",
    OLD."operation_key",
    OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id",
    NEW."batch_id",
    NEW."producer_id",
    NEW."operation_key",
    NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_ACTIVE_WORK_ROW_IDENTITY_IMMUTABLE';
  END IF;

  IF OLD."materialized_at" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'SKITZA_ACTIVE_WORK_CREATED_ROW_IMMUTABLE';
  END IF;

  IF NEW."draft_revision" < OLD."draft_revision" THEN
    RAISE EXCEPTION 'SKITZA_ACTIVE_WORK_DRAFT_REVISION_REGRESSION';
  END IF;

  IF NEW."draft_payload" IS DISTINCT FROM OLD."draft_payload"
    AND NEW."draft_revision" <= OLD."draft_revision"
  THEN
    RAISE EXCEPTION 'SKITZA_ACTIVE_WORK_DRAFT_REVISION_REQUIRED';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "active_work_import_rows_guard_mutation"
  BEFORE UPDATE OR DELETE ON "active_work_import_rows"
  FOR EACH ROW EXECUTE FUNCTION "protect_active_work_import_row"();

CREATE FUNCTION "protect_client_invitation_email_delivery"()
RETURNS trigger AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SKITZA_CLIENT_INVITATION_EMAIL_DELETE_FORBIDDEN';
  END IF;

  IF ROW(
    OLD."id",
    OLD."client_contact_id",
    OLD."producer_id",
    OLD."operation_key",
    OLD."operation_digest",
    OLD."recipient_email",
    OLD."recipient_email_hash",
    OLD."message_snapshot",
    OLD."requested_by_clerk_user_id",
    OLD."provider_idempotency_key",
    OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id",
    NEW."client_contact_id",
    NEW."producer_id",
    NEW."operation_key",
    NEW."operation_digest",
    NEW."recipient_email",
    NEW."recipient_email_hash",
    NEW."message_snapshot",
    NEW."requested_by_clerk_user_id",
    NEW."provider_idempotency_key",
    NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_CLIENT_INVITATION_EMAIL_INTENT_IMMUTABLE';
  END IF;

  IF OLD."first_attempt_at" IS NOT NULL
    AND NEW."first_attempt_at" IS DISTINCT FROM OLD."first_attempt_at"
  THEN
    RAISE EXCEPTION 'SKITZA_CLIENT_INVITATION_FIRST_ATTEMPT_IMMUTABLE';
  END IF;

  IF OLD."provider_dedupe_expires_at" IS NOT NULL
    AND NEW."provider_dedupe_expires_at" IS DISTINCT FROM OLD."provider_dedupe_expires_at"
  THEN
    RAISE EXCEPTION 'SKITZA_CLIENT_INVITATION_DEDUPE_WINDOW_IMMUTABLE';
  END IF;

  IF NEW."attempt_count" < OLD."attempt_count" THEN
    RAISE EXCEPTION 'SKITZA_CLIENT_INVITATION_ATTEMPT_COUNT_REGRESSION';
  END IF;

  IF OLD."status" IN ('provider_accepted', 'dedupe_expired')
    AND NEW IS DISTINCT FROM OLD
  THEN
    RAISE EXCEPTION 'SKITZA_CLIENT_INVITATION_TERMINAL_STATE_IMMUTABLE';
  END IF;

  IF OLD."status" <> NEW."status" AND NOT (
    (OLD."status" = 'reserved' AND NEW."status" = 'sending')
    OR (
      OLD."status" = 'sending'
      AND NEW."status" IN ('provider_accepted', 'failed', 'dedupe_expired')
    )
    OR (
      OLD."status" = 'failed'
      AND NEW."status" IN ('sending', 'dedupe_expired')
    )
  ) THEN
    RAISE EXCEPTION 'SKITZA_CLIENT_INVITATION_STATE_TRANSITION_FORBIDDEN';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "client_invitation_email_deliveries_guard_mutation"
  BEFORE UPDATE OR DELETE ON "client_invitation_email_deliveries"
  FOR EACH ROW EXECUTE FUNCTION "protect_client_invitation_email_delivery"();
