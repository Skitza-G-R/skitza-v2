-- SK-133: one minimal registered-account lifecycle snapshot per Clerk user.
-- Business roles remain derived from producers/client_contacts so this table
-- cannot turn an unregistered CRM contact into an Admin user-directory row.

CREATE TABLE "registered_accounts" (
  "clerk_user_id" text PRIMARY KEY,
  "primary_email" text,
  "display_name" text,
  "email_verified" boolean,
  "audience_type" text NOT NULL DEFAULT 'unknown',
  "provider_state" text NOT NULL DEFAULT 'needs_sync',
  "provider_created_at" timestamp with time zone,
  "provider_updated_at" timestamp with time zone,
  "last_sign_in_at" timestamp with time zone,
  "last_webhook_event_id" text,
  "synced_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "registered_accounts_identity_shape"
    CHECK (
      "clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      AND (
        "primary_email" IS NULL
        OR (
          "primary_email" = lower(btrim("primary_email"))
          AND char_length("primary_email") BETWEEN 3 AND 320
        )
      )
      AND (
        "display_name" IS NULL
        OR (
          NULLIF(btrim("display_name"), '') IS NOT NULL
          AND char_length("display_name") <= 160
        )
      )
      AND (
        "last_webhook_event_id" IS NULL
        OR (
          NULLIF(btrim("last_webhook_event_id"), '') IS NOT NULL
          AND char_length("last_webhook_event_id") <= 255
        )
      )
    ),
  CONSTRAINT "registered_accounts_provider_state_shape"
    CHECK ("provider_state" IN ('active', 'banned', 'locked', 'deleted', 'needs_sync')),
  CONSTRAINT "registered_accounts_audience_type_shape"
    CHECK ("audience_type" IN ('external', 'internal', 'unknown')),
  CONSTRAINT "registered_accounts_sync_shape"
    CHECK (
      (
        "provider_state" = 'needs_sync'
        AND "provider_updated_at" IS NULL
        AND "last_webhook_event_id" IS NULL
        AND "synced_at" IS NULL
      )
      OR (
        "provider_state" <> 'needs_sync'
        AND "provider_updated_at" IS NOT NULL
        AND "last_webhook_event_id" IS NOT NULL
        AND "synced_at" IS NOT NULL
      )
    ),
  CONSTRAINT "registered_accounts_deleted_pii_shape"
    CHECK (
      "provider_state" <> 'deleted'
      OR (
        "primary_email" IS NULL
        AND "display_name" IS NULL
        AND "email_verified" IS NULL
        AND "audience_type" = 'unknown'
        AND "last_sign_in_at" IS NULL
      )
    ),
  CONSTRAINT "registered_accounts_timestamp_shape"
    CHECK (
      ("provider_created_at" IS NULL OR "provider_updated_at" IS NULL OR "provider_created_at" <= "provider_updated_at")
      AND "updated_at" >= "created_at"
  )
);

CREATE OR REPLACE FUNCTION "skitza_guard_registered_account_tombstone"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."provider_state" = 'deleted'
    AND NEW."provider_state" <> 'deleted'
  THEN
    RAISE EXCEPTION 'SKITZA_REGISTERED_ACCOUNT_TOMBSTONE_TERMINAL'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "registered_accounts_terminal_tombstone"
  BEFORE UPDATE ON "registered_accounts"
  FOR EACH ROW
  EXECUTE FUNCTION "skitza_guard_registered_account_tombstone"();

CREATE INDEX "registered_accounts_provider_state_idx"
  ON "registered_accounts" ("provider_state", "clerk_user_id");
CREATE INDEX "registered_accounts_provider_created_idx"
  ON "registered_accounts" (
    (CASE WHEN "provider_created_at" IS NULL THEN 1 ELSE 0 END),
    "provider_created_at" DESC NULLS LAST,
    "clerk_user_id" DESC
  )
  WHERE "provider_state" <> 'deleted';
CREATE INDEX "registered_accounts_email_search_idx"
  ON "registered_accounts" (lower("primary_email") text_pattern_ops, "clerk_user_id");
CREATE INDEX "registered_accounts_name_search_idx"
  ON "registered_accounts" (lower("display_name") text_pattern_ops, "clerk_user_id");
CREATE INDEX "registered_accounts_clerk_id_search_idx"
  ON "registered_accounts" (
    lower("clerk_user_id") text_pattern_ops,
    "clerk_user_id"
  );
CREATE INDEX "producers_admin_email_search_idx"
  ON "producers" (lower("email") text_pattern_ops, "clerk_user_id");
CREATE INDEX "producers_admin_name_search_idx"
  ON "producers" (lower("display_name") text_pattern_ops, "clerk_user_id");
CREATE INDEX "client_contacts_admin_email_search_idx"
  ON "client_contacts" (
    lower("email") text_pattern_ops,
    "clerk_user_id"
  )
  WHERE "clerk_user_id" IS NOT NULL;
CREATE INDEX "client_contacts_admin_name_search_idx"
  ON "client_contacts" (
    lower("name") text_pattern_ops,
    "clerk_user_id"
  )
  WHERE "clerk_user_id" IS NOT NULL;

-- Every accepted Clerk lifecycle webhook is claimed exactly once inside the
-- same database transaction as the registered-account and role mappings.
-- The digest makes a reused Svix ID with different content fail closed.
CREATE TABLE "clerk_user_sync_receipts" (
  "event_id" text PRIMARY KEY,
  "event_digest" text NOT NULL,
  "event_type" text NOT NULL,
  "clerk_user_id" text NOT NULL,
  "clerk_instance_id" text NOT NULL,
  "provider_updated_at" timestamp with time zone NOT NULL,
  "processed_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "clerk_user_sync_receipts_shape"
    CHECK (
      NULLIF(btrim("event_id"), '') IS NOT NULL
      AND char_length("event_id") <= 255
      AND "event_digest" ~ '^sha256:[0-9a-f]{64}$'
      AND "event_type" IN ('user.created', 'user.updated', 'user.deleted')
      AND "clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      AND "clerk_instance_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
    )
);

CREATE INDEX "clerk_user_sync_receipts_user_idx"
  ON "clerk_user_sync_receipts" ("clerk_user_id", "provider_updated_at" DESC, "event_id");

CREATE TRIGGER "clerk_user_sync_receipts_append_only"
  BEFORE UPDATE OR DELETE ON "clerk_user_sync_receipts"
  FOR EACH ROW
  EXECUTE FUNCTION "prevent_append_only_mutation"();

CREATE INDEX "client_contacts_active_clerk_user_idx"
  ON "client_contacts" ("clerk_user_id", "last_seen_at" DESC, "id")
  WHERE "clerk_user_id" IS NOT NULL AND "archived_at" IS NULL;
CREATE INDEX "purchase_requests_admin_activation_idx"
  ON "purchase_requests" ("producer_id", "created_at", "client_contact_id");
CREATE INDEX "purchases_admin_activation_idx"
  ON "purchases" ("producer_id", "created_at", "client_contact_id");
CREATE INDEX "bookings_admin_activation_idx"
  ON "bookings" ("producer_id", "created_at", "purchase_id");
CREATE INDEX "projects_admin_client_activity_idx"
  ON "projects" ("client_contact_id", "created_at" DESC, "id" DESC);
CREATE INDEX "purchase_requests_admin_client_activity_idx"
  ON "purchase_requests" ("client_contact_id", "created_at" DESC, "id" DESC);
CREATE INDEX "payment_proofs_admin_client_activity_idx"
  ON "payment_proofs" ("client_contact_id", "created_at" DESC, "id" DESC);
CREATE INDEX "admin_action_history_target_account_occurred_idx"
  ON "admin_action_history" (
    "environment",
    "target_account_clerk_user_id",
    "occurred_at" DESC,
    "id" DESC
  )
  WHERE "target_account_clerk_user_id" IS NOT NULL;

-- Existing producer rows prove a Clerk ID mapping, but not the current Clerk
-- lifecycle state. Keep the provider facts unknown until a signed webhook
-- reconciles the account.
INSERT INTO "registered_accounts" (
  "clerk_user_id"
)
SELECT
  "clerk_user_id"
FROM "producers"
ON CONFLICT ("clerk_user_id") DO NOTHING;

-- A contact is included only when it already carries a Clerk user ID.
-- Producer-entered contact email/name values are intentionally not copied
-- into provider identity columns. Admin reads may show them separately as
-- explicitly labelled Skitza relationship context.
WITH "registered_artist_mappings" AS (
  SELECT DISTINCT
    "clerk_user_id"
  FROM "client_contacts"
  WHERE "clerk_user_id" IS NOT NULL
)
INSERT INTO "registered_accounts" (
  "clerk_user_id"
)
SELECT
  "clerk_user_id"
FROM "registered_artist_mappings"
ON CONFLICT ("clerk_user_id") DO NOTHING;
