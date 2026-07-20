-- SK-97: idempotent purchase-ledger corrections, waivers, cancellations,
-- reminders, and audited payment-driven project pauses.
--
-- This migration is schema-only. It preserves existing append-only history,
-- does not synthesize commercial data, and does not touch proof evidence.

ALTER TABLE "producers"
  ALTER COLUMN "autopilot_unpaid_reminder" SET DEFAULT true;

-- SK-90 created the exact schedule at acceptance but left every due timestamp
-- null. The first installment is acceptance-triggered by definition, so its
-- durable due/trigger anchor is the immutable accepted_at value. Future
-- Monthly dates remain runtime-anchored to the first confirmed payment.
UPDATE "purchase_installments" AS installment
SET
  "due_at" = purchase."accepted_at",
  "triggered_at" = purchase."accepted_at",
  "updated_at" = GREATEST(installment."updated_at", purchase."accepted_at")
FROM "purchases" AS purchase
WHERE installment."purchase_id" = purchase."id"
  AND installment."producer_id" = purchase."producer_id"
  AND installment."position" = 1
  AND installment."due_trigger" = 'acceptance'
  AND installment."due_at" IS NULL
  AND installment."triggered_at" IS NULL;

-- Existing history is protected by BEFORE UPDATE triggers. Materialize stable
-- legacy operation identities from each immutable row id as stored generated
-- columns, then convert them to ordinary required columns without UPDATE.
ALTER TABLE "purchase_payment_corrections"
  ADD COLUMN "operation_key" text GENERATED ALWAYS AS (
    'legacy:purchase-payment-correction:' || "id"::text
  ) STORED,
  ADD COLUMN "operation_digest" text GENERATED ALWAYS AS (
    'legacy:purchase-payment-correction-digest:' || "id"::text
  ) STORED;

ALTER TABLE "purchase_payment_corrections"
  ALTER COLUMN "operation_key" DROP EXPRESSION,
  ALTER COLUMN "operation_digest" DROP EXPRESSION,
  ALTER COLUMN "operation_key" SET NOT NULL,
  ALTER COLUMN "operation_digest" SET NOT NULL,
  ADD CONSTRAINT "purchase_payment_corrections_operation_key_unique"
    UNIQUE ("purchase_id", "operation_key"),
  ADD CONSTRAINT "purchase_payment_corrections_operation_shape"
    CHECK (
      NULLIF(btrim("operation_key"), '') IS NOT NULL
      AND NULLIF(btrim("operation_digest"), '') IS NOT NULL
    ),
  ADD CONSTRAINT "purchase_payment_corrections_reason_shape"
    CHECK (NULLIF(btrim("reason"), '') IS NOT NULL),
  ADD CONSTRAINT "purchase_payment_corrections_amount_changed"
    CHECK ("previous_amount_cents" <> "new_amount_cents");

CREATE INDEX "purchase_payment_corrections_purchase_created_idx"
  ON "purchase_payment_corrections" ("purchase_id", "created_at", "id");

ALTER TABLE "purchase_waivers"
  ADD COLUMN "operation_key" text GENERATED ALWAYS AS (
    'legacy:purchase-waiver:' || "id"::text
  ) STORED,
  ADD COLUMN "operation_digest" text GENERATED ALWAYS AS (
    'legacy:purchase-waiver-digest:' || "id"::text
  ) STORED;

ALTER TABLE "purchase_waivers"
  ALTER COLUMN "operation_key" DROP EXPRESSION,
  ALTER COLUMN "operation_digest" DROP EXPRESSION,
  ALTER COLUMN "operation_key" SET NOT NULL,
  ALTER COLUMN "operation_digest" SET NOT NULL,
  ADD CONSTRAINT "purchase_waivers_operation_key_unique"
    UNIQUE ("purchase_id", "operation_key"),
  ADD CONSTRAINT "purchase_waivers_operation_shape"
    CHECK (
      NULLIF(btrim("operation_key"), '') IS NOT NULL
      AND NULLIF(btrim("operation_digest"), '') IS NOT NULL
    ),
  ADD CONSTRAINT "purchase_waivers_reason_shape"
    CHECK (NULLIF(btrim("reason"), '') IS NOT NULL);

CREATE INDEX "purchase_waivers_purchase_created_idx"
  ON "purchase_waivers" ("purchase_id", "created_at", "id");

ALTER TABLE "purchase_cancellations"
  ADD COLUMN "operation_key" text GENERATED ALWAYS AS (
    'legacy:purchase-cancellation:' || "id"::text
  ) STORED,
  ADD COLUMN "operation_digest" text GENERATED ALWAYS AS (
    'legacy:purchase-cancellation-digest:' || "id"::text
  ) STORED;

ALTER TABLE "purchase_cancellations"
  ALTER COLUMN "operation_key" DROP EXPRESSION,
  ALTER COLUMN "operation_digest" DROP EXPRESSION,
  ALTER COLUMN "operation_key" SET NOT NULL,
  ALTER COLUMN "operation_digest" SET NOT NULL,
  ADD CONSTRAINT "purchase_cancellations_operation_key_unique"
    UNIQUE ("purchase_id", "operation_key"),
  ADD CONSTRAINT "purchase_cancellations_operation_shape"
    CHECK (
      NULLIF(btrim("operation_key"), '') IS NOT NULL
      AND NULLIF(btrim("operation_digest"), '') IS NOT NULL
    ),
  ADD CONSTRAINT "purchase_cancellations_reason_shape"
    CHECK (NULLIF(btrim("reason"), '') IS NOT NULL);

CREATE TYPE "purchase_reminder_kind" AS ENUM (
  'automatic_3_days_before',
  'automatic_due',
  'automatic_3_days_late',
  'automatic_weekly_late',
  'manual'
);

CREATE TYPE "purchase_reminder_delivery_status" AS ENUM (
  'reserved',
  'sending',
  'sent',
  'reservation_expired',
  'dedupe_expired'
);

CREATE TABLE "purchase_reminder_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purchase_id" uuid NOT NULL,
  "installment_id" uuid NOT NULL,
  "producer_id" uuid NOT NULL,
  "operation_key" text NOT NULL,
  "operation_digest" text NOT NULL,
  "kind" "purchase_reminder_kind" NOT NULL,
  "scheduled_for" timestamp with time zone NOT NULL,
  "amount_due_cents" integer NOT NULL,
  "currency" text NOT NULL,
  "recipient_email" text NOT NULL,
  "message_snapshot" jsonb NOT NULL,
  "sent_by_clerk_user_id" text,
  "provider_idempotency_key" text NOT NULL,
  "status" "purchase_reminder_delivery_status" DEFAULT 'reserved' NOT NULL,
  "claim_token" text,
  "claim_until" timestamp with time zone,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "first_attempt_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone,
  "provider_dedupe_expires_at" timestamp with time zone,
  "last_failed_at" timestamp with time zone,
  "provider_message_id" text,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_reminder_deliveries_operation_key_unique"
    UNIQUE ("purchase_id", "operation_key"),
  CONSTRAINT "purchase_reminder_deliveries_provider_idempotency_unique"
    UNIQUE ("provider_idempotency_key"),
  CONSTRAINT "purchase_reminder_deliveries_purchase_producer_fk"
    FOREIGN KEY ("purchase_id", "producer_id")
    REFERENCES "purchases" ("id", "producer_id") ON DELETE RESTRICT,
  CONSTRAINT "purchase_reminder_deliveries_installment_purchase_currency_fk"
    FOREIGN KEY ("installment_id", "purchase_id", "currency")
    REFERENCES "purchase_installments" ("id", "purchase_id", "currency")
    ON DELETE RESTRICT,
  CONSTRAINT "purchase_reminder_deliveries_positive_amount"
    CHECK ("amount_due_cents" > 0),
  CONSTRAINT "purchase_reminder_deliveries_operation_shape" CHECK (
    NULLIF(btrim("operation_key"), '') IS NOT NULL
    AND NULLIF(btrim("operation_digest"), '') IS NOT NULL
    AND NULLIF(btrim("provider_idempotency_key"), '') IS NOT NULL
  ),
  CONSTRAINT "purchase_reminder_deliveries_actor_shape" CHECK ((
    (
      "kind" = 'manual'
      AND NULLIF(btrim("sent_by_clerk_user_id"), '') IS NOT NULL
    )
    OR (
      "kind" <> 'manual'
      AND "sent_by_clerk_user_id" IS NULL
    )
  ) IS TRUE),
  CONSTRAINT "purchase_reminder_deliveries_snapshot_shape" CHECK ((
    NULLIF(btrim("currency"), '') IS NOT NULL
    AND NULLIF(btrim("recipient_email"), '') IS NOT NULL
    AND char_length("provider_idempotency_key") <= 256
    AND "message_snapshot"->>'to' = "recipient_email"
    AND "message_snapshot"->'props'->>'currency' = "currency"
    AND ("message_snapshot"->'props'->>'amountCents')::integer = "amount_due_cents"
  ) IS TRUE),
  CONSTRAINT "purchase_reminder_deliveries_attempt_shape" CHECK ((
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
  CONSTRAINT "purchase_reminder_deliveries_state_shape" CHECK ((
    (
      "status" = 'reserved'
      AND "claim_token" IS NULL
      AND "claim_until" IS NULL
      AND "provider_message_id" IS NULL
      AND "sent_at" IS NULL
    )
    OR (
      "status" = 'sending'
      AND NULLIF(btrim("claim_token"), '') IS NOT NULL
      AND "claim_until" IS NOT NULL
      AND "attempt_count" > 0
      AND "provider_message_id" IS NULL
      AND "sent_at" IS NULL
    )
    OR (
      "status" = 'sent'
      AND "claim_token" IS NULL
      AND "claim_until" IS NULL
      AND NULLIF(btrim("provider_message_id"), '') IS NOT NULL
      AND "sent_at" IS NOT NULL
    )
    OR (
      "status" = 'reservation_expired'
      AND "claim_token" IS NULL
      AND "claim_until" IS NULL
      AND "attempt_count" = 0
      AND "provider_message_id" IS NULL
      AND "sent_at" IS NULL
    )
    OR (
      "status" = 'dedupe_expired'
      AND "claim_token" IS NULL
      AND "claim_until" IS NULL
      AND "attempt_count" > 0
      AND "provider_message_id" IS NULL
      AND "sent_at" IS NULL
    )
  ) IS TRUE)
);

CREATE UNIQUE INDEX "purchase_reminder_deliveries_automatic_occurrence_unique"
  ON "purchase_reminder_deliveries" ("installment_id", "kind", "scheduled_for")
  WHERE "kind" <> 'manual';

CREATE INDEX "purchase_reminder_deliveries_claim_idx"
  ON "purchase_reminder_deliveries" ("status", "claim_until", "id");

CREATE INDEX "purchase_reminder_deliveries_producer_updated_idx"
  ON "purchase_reminder_deliveries" ("producer_id", "updated_at", "id");

CREATE TABLE "purchase_reminder_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purchase_id" uuid NOT NULL,
  "installment_id" uuid NOT NULL,
  "producer_id" uuid NOT NULL,
  "operation_key" text NOT NULL,
  "operation_digest" text NOT NULL,
  "kind" "purchase_reminder_kind" NOT NULL,
  "scheduled_for" timestamp with time zone NOT NULL,
  "amount_due_cents" integer NOT NULL,
  "currency" text NOT NULL,
  "recipient_email" text NOT NULL,
  "sent_by_clerk_user_id" text,
  "provider_message_id" text NOT NULL,
  "sent_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_reminder_logs_operation_key_unique"
    UNIQUE ("purchase_id", "operation_key"),
  CONSTRAINT "purchase_reminder_logs_purchase_producer_fk"
    FOREIGN KEY ("purchase_id", "producer_id")
    REFERENCES "purchases" ("id", "producer_id") ON DELETE RESTRICT,
  CONSTRAINT "purchase_reminder_logs_installment_purchase_currency_fk"
    FOREIGN KEY ("installment_id", "purchase_id", "currency")
    REFERENCES "purchase_installments" ("id", "purchase_id", "currency")
    ON DELETE RESTRICT,
  CONSTRAINT "purchase_reminder_logs_delivery_operation_fk"
    FOREIGN KEY ("purchase_id", "operation_key")
    REFERENCES "purchase_reminder_deliveries" ("purchase_id", "operation_key")
    ON DELETE RESTRICT,
  CONSTRAINT "purchase_reminder_logs_positive_amount"
    CHECK ("amount_due_cents" > 0),
  CONSTRAINT "purchase_reminder_logs_operation_shape"
    CHECK (
      NULLIF(btrim("operation_key"), '') IS NOT NULL
      AND NULLIF(btrim("operation_digest"), '') IS NOT NULL
    ),
  CONSTRAINT "purchase_reminder_logs_delivery_shape"
    CHECK (
      NULLIF(btrim("currency"), '') IS NOT NULL
      AND NULLIF(btrim("recipient_email"), '') IS NOT NULL
      AND NULLIF(btrim("provider_message_id"), '') IS NOT NULL
    ),
  CONSTRAINT "purchase_reminder_logs_actor_shape" CHECK ((
    (
      "kind" = 'manual'
      AND NULLIF(btrim("sent_by_clerk_user_id"), '') IS NOT NULL
    )
    OR (
      "kind" <> 'manual'
      AND "sent_by_clerk_user_id" IS NULL
    )
  ) IS TRUE)
);

CREATE UNIQUE INDEX "purchase_reminder_logs_automatic_occurrence_unique"
  ON "purchase_reminder_logs" ("installment_id", "kind", "scheduled_for")
  WHERE "kind" <> 'manual';

CREATE INDEX "purchase_reminder_logs_producer_sent_idx"
  ON "purchase_reminder_logs" ("producer_id", "sent_at", "id");

CREATE INDEX "purchase_reminder_logs_installment_sent_idx"
  ON "purchase_reminder_logs" ("installment_id", "sent_at", "id");

CREATE TYPE "project_payment_pause_action" AS ENUM ('paused', 'resumed');

CREATE TABLE "project_payment_pause_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purchase_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "producer_id" uuid NOT NULL,
  "action" "project_payment_pause_action" NOT NULL,
  "operation_key" text NOT NULL,
  "operation_digest" text NOT NULL,
  "reason" text NOT NULL,
  "changed_by_clerk_user_id" text NOT NULL,
  "changed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_payment_pause_events_operation_key_unique"
    UNIQUE ("project_id", "operation_key"),
  CONSTRAINT "project_payment_pause_events_project_producer_fk"
    FOREIGN KEY ("project_id", "producer_id")
    REFERENCES "projects" ("id", "producer_id") ON DELETE RESTRICT,
  CONSTRAINT "project_payment_pause_events_purchase_project_fk"
    FOREIGN KEY ("purchase_id", "project_id")
    REFERENCES "purchases" ("id", "project_id") ON DELETE RESTRICT,
  CONSTRAINT "project_payment_pause_events_operation_shape"
    CHECK (
      NULLIF(btrim("operation_key"), '') IS NOT NULL
      AND NULLIF(btrim("operation_digest"), '') IS NOT NULL
    ),
  CONSTRAINT "project_payment_pause_events_reason_shape"
    CHECK (NULLIF(btrim("reason"), '') IS NOT NULL),
  CONSTRAINT "project_payment_pause_events_actor_shape"
    CHECK (NULLIF(btrim("changed_by_clerk_user_id"), '') IS NOT NULL)
);

CREATE INDEX "project_payment_pause_events_project_changed_idx"
  ON "project_payment_pause_events" ("project_id", "changed_at", "id");

CREATE INDEX "project_payment_pause_events_purchase_changed_idx"
  ON "project_payment_pause_events" ("purchase_id", "changed_at", "id");

-- The outbox lifecycle is mutable, but its delivery intent and provider
-- dedupe anchor are not. In particular, no retry path may extend the original
-- 24-hour provider window after an uncertain send.
CREATE OR REPLACE FUNCTION "protect_purchase_reminder_delivery"()
RETURNS trigger AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_REMINDER_DELIVERY_DELETE_FORBIDDEN';
  END IF;
  IF ROW(
    OLD."id", OLD."purchase_id", OLD."installment_id", OLD."producer_id",
    OLD."operation_key", OLD."operation_digest", OLD."kind",
    OLD."scheduled_for", OLD."amount_due_cents", OLD."currency",
    OLD."recipient_email", OLD."message_snapshot", OLD."sent_by_clerk_user_id",
    OLD."provider_idempotency_key", OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id", NEW."purchase_id", NEW."installment_id", NEW."producer_id",
    NEW."operation_key", NEW."operation_digest", NEW."kind",
    NEW."scheduled_for", NEW."amount_due_cents", NEW."currency",
    NEW."recipient_email", NEW."message_snapshot", NEW."sent_by_clerk_user_id",
    NEW."provider_idempotency_key", NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_REMINDER_DELIVERY_INTENT_IMMUTABLE';
  END IF;
  IF OLD."first_attempt_at" IS NOT NULL
    AND NEW."first_attempt_at" IS DISTINCT FROM OLD."first_attempt_at"
  THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_REMINDER_FIRST_ATTEMPT_IMMUTABLE';
  END IF;
  IF OLD."provider_dedupe_expires_at" IS NOT NULL
    AND NEW."provider_dedupe_expires_at" IS DISTINCT FROM OLD."provider_dedupe_expires_at"
  THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_REMINDER_DEDUPE_WINDOW_IMMUTABLE';
  END IF;
  IF NEW."attempt_count" < OLD."attempt_count" THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_REMINDER_ATTEMPT_COUNT_REGRESSION';
  END IF;
  IF OLD."status" IN ('sent', 'reservation_expired', 'dedupe_expired')
    AND NEW IS DISTINCT FROM OLD
  THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_REMINDER_TERMINAL_STATE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "purchase_reminder_deliveries_protect"
  BEFORE UPDATE OR DELETE ON "purchase_reminder_deliveries"
  FOR EACH ROW EXECUTE FUNCTION "protect_purchase_reminder_delivery"();

-- Confirmed is a projection, not immutable history: an audited downward
-- correction may make that installment collectible again. Cancellation
-- remains terminal, while accepted schedule terms and dates stay
-- immutable exactly as established by SK-90.
CREATE OR REPLACE FUNCTION "protect_purchase_installment_terms"()
RETURNS trigger AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_INSTALLMENT_DELETE_FORBIDDEN';
  END IF;
  IF ROW(
    OLD."id", OLD."purchase_id", OLD."producer_id", OLD."position",
    OLD."amount_cents", OLD."currency", OLD."due_trigger",
    OLD."required_for_activation", OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id", NEW."purchase_id", NEW."producer_id", NEW."position",
    NEW."amount_cents", NEW."currency", NEW."due_trigger",
    NEW."required_for_activation", NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_INSTALLMENT_TERMS_IMMUTABLE';
  END IF;
  IF OLD."due_at" IS NOT NULL AND NEW."due_at" IS DISTINCT FROM OLD."due_at" THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_INSTALLMENT_DUE_AT_IMMUTABLE';
  END IF;
  IF OLD."triggered_at" IS NOT NULL
    AND NEW."triggered_at" IS DISTINCT FROM OLD."triggered_at"
  THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_INSTALLMENT_TRIGGERED_AT_IMMUTABLE';
  END IF;
  IF OLD."status" = 'canceled'
    AND NEW."status" IS DISTINCT FROM OLD."status"
  THEN
    RAISE EXCEPTION 'SKITZA_PURCHASE_INSTALLMENT_TERMINAL_STATUS_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "purchase_reminder_logs_append_only"
  BEFORE UPDATE OR DELETE ON "purchase_reminder_logs"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

CREATE TRIGGER "project_payment_pause_events_append_only"
  BEFORE UPDATE OR DELETE ON "project_payment_pause_events"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();
