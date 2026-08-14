-- SK-229: preserve stable application identity while moving the six existing
-- principals between Clerk instances. Provider ids are never rewritten into
-- historical role, ownership, or audit rows.

CREATE TYPE "clerk_identity_binding_kind" AS ENUM ('native', 'relink');
CREATE TYPE "clerk_identity_binding_status" AS ENUM ('staged', 'active', 'revoked');

CREATE TABLE "clerk_identity_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clerk_instance_id" text NOT NULL,
  "provider_clerk_user_id" text NOT NULL,
  "canonical_clerk_user_id" text NOT NULL,
  "kind" "clerk_identity_binding_kind" NOT NULL,
  "status" "clerk_identity_binding_status" NOT NULL DEFAULT 'staged',
  "batch_id" uuid NOT NULL,
  "verified_email_hash" text NOT NULL,
  "source_clerk_instance_id" text,
  "source_provider_clerk_user_id" text,
  "manifest_digest" text NOT NULL,
  "evidence_ref" text NOT NULL,
  "staged_at" timestamp with time zone NOT NULL DEFAULT now(),
  "activated_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "clerk_identity_bindings_identity_shape" CHECK (
    "clerk_instance_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
    AND "provider_clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
    AND "canonical_clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
    AND "verified_email_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "manifest_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND NULLIF(btrim("evidence_ref"), '') IS NOT NULL
    AND char_length("evidence_ref") <= 255
  ),
  CONSTRAINT "clerk_identity_bindings_source_shape" CHECK (
    (
      "kind" = 'native'
      AND "source_clerk_instance_id" IS NULL
      AND "source_provider_clerk_user_id" IS NULL
      AND "canonical_clerk_user_id" = "provider_clerk_user_id"
    ) OR (
      "kind" = 'relink'
      AND "source_clerk_instance_id" IS NOT NULL
      AND "source_provider_clerk_user_id" IS NOT NULL
      AND "source_clerk_instance_id" <> "clerk_instance_id"
      AND "source_provider_clerk_user_id" = "canonical_clerk_user_id"
    )
  ),
  CONSTRAINT "clerk_identity_bindings_lifecycle_shape" CHECK (
    (
      "status" = 'staged'
      AND "activated_at" IS NULL
      AND "revoked_at" IS NULL
    ) OR (
      "status" = 'active'
      AND "activated_at" IS NOT NULL
      AND "activated_at" >= "staged_at"
      AND "revoked_at" IS NULL
    ) OR (
      "status" = 'revoked'
      AND "revoked_at" IS NOT NULL
      AND "revoked_at" >= coalesce("activated_at", "staged_at")
    ) IS TRUE
  )
);

CREATE UNIQUE INDEX "clerk_identity_bindings_provider_live_unique"
  ON "clerk_identity_bindings" ("clerk_instance_id", "provider_clerk_user_id")
  WHERE "status" IN ('staged', 'active');

CREATE UNIQUE INDEX "clerk_identity_bindings_canonical_active_unique"
  ON "clerk_identity_bindings" ("clerk_instance_id", "canonical_clerk_user_id")
  WHERE "status" = 'active';

CREATE INDEX "clerk_identity_bindings_canonical_lookup_idx"
  ON "clerk_identity_bindings" ("canonical_clerk_user_id", "status", "clerk_instance_id");

CREATE INDEX "clerk_identity_bindings_batch_idx"
  ON "clerk_identity_bindings" ("batch_id", "status", "id");

CREATE FUNCTION "guard_clerk_identity_binding_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'clerk-provider-owner:' || NEW.clerk_instance_id || ':' || NEW.provider_clerk_user_id,
        0
      )
    );

    IF EXISTS (
      SELECT 1
      FROM "clerk_identity_bindings" AS existing
      WHERE existing."clerk_instance_id" = NEW.clerk_instance_id
        AND existing."provider_clerk_user_id" = NEW.provider_clerk_user_id
        AND existing."canonical_clerk_user_id" <> NEW.canonical_clerk_user_id
    ) THEN
      RAISE EXCEPTION 'clerk provider identity ownership is immutable';
    END IF;

    IF NEW.kind = 'relink' AND NEW.status <> 'staged' THEN
      RAISE EXCEPTION 'clerk relink bindings must be inserted staged';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clerk identity bindings cannot be deleted';
  END IF;

  IF ROW(
    NEW.id,
    NEW.clerk_instance_id,
    NEW.provider_clerk_user_id,
    NEW.canonical_clerk_user_id,
    NEW.kind,
    NEW.batch_id,
    NEW.verified_email_hash,
    NEW.source_clerk_instance_id,
    NEW.source_provider_clerk_user_id,
    NEW.manifest_digest,
    NEW.evidence_ref,
    NEW.staged_at
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.clerk_instance_id,
    OLD.provider_clerk_user_id,
    OLD.canonical_clerk_user_id,
    OLD.kind,
    OLD.batch_id,
    OLD.verified_email_hash,
    OLD.source_clerk_instance_id,
    OLD.source_provider_clerk_user_id,
    OLD.manifest_digest,
    OLD.evidence_ref,
    OLD.staged_at
  ) THEN
    RAISE EXCEPTION 'clerk identity binding evidence is immutable';
  END IF;

  IF NOT (
    OLD.status = 'staged'
    AND NEW.status = 'active'
    AND NEW.activated_at IS NOT NULL
    AND NEW.revoked_at IS NULL
  ) AND NOT (
    OLD.status = 'staged'
    AND NEW.status = 'revoked'
    AND NEW.activated_at IS NULL
    AND NEW.revoked_at IS NOT NULL
  ) AND NOT (
    OLD.status = 'active'
    AND NEW.status = 'revoked'
    AND NEW.activated_at = OLD.activated_at
    AND NEW.revoked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'invalid clerk identity binding transition';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "clerk_identity_bindings_guard_mutation"
  BEFORE INSERT OR UPDATE OR DELETE ON "clerk_identity_bindings"
  FOR EACH ROW
  EXECUTE FUNCTION "guard_clerk_identity_binding_mutation"();

-- registered_accounts remains keyed by the stable canonical id. Legacy
-- needs_sync rows intentionally keep both provider columns NULL until a
-- signed webhook from an active binding supplies the provider tuple.
ALTER TABLE "registered_accounts"
  ADD COLUMN "provider_clerk_user_id" text,
  ADD COLUMN "clerk_instance_id" text;

-- Existing synchronized rows predate the split identity columns. Recover the
-- provider tuple only from the exact immutable receipt named by the account;
-- never guess the Clerk instance from an email, timestamp, or current env.
UPDATE "registered_accounts" AS account
SET
  "provider_clerk_user_id" = receipt."clerk_user_id",
  "clerk_instance_id" = receipt."clerk_instance_id"
FROM "clerk_user_sync_receipts" AS receipt
WHERE account."provider_state" <> 'needs_sync'
  AND receipt."event_id" = account."last_webhook_event_id"
  AND receipt."clerk_user_id" = account."clerk_user_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "registered_accounts"
    WHERE "provider_state" <> 'needs_sync'
      AND (
        "provider_clerk_user_id" IS NULL
        OR "clerk_instance_id" IS NULL
      )
  ) THEN
    RAISE EXCEPTION
      'registered account lacks exact Clerk webhook receipt for identity backfill';
  END IF;
END;
$$;

ALTER TABLE "registered_accounts"
  DROP CONSTRAINT "registered_accounts_identity_shape",
  DROP CONSTRAINT "registered_accounts_sync_shape";

ALTER TABLE "registered_accounts"
  ADD CONSTRAINT "registered_accounts_identity_shape" CHECK (
    "clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
    AND (
      "provider_clerk_user_id" IS NULL
      OR "provider_clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
    )
    AND (
      "clerk_instance_id" IS NULL
      OR "clerk_instance_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
    )
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
  ADD CONSTRAINT "registered_accounts_sync_shape" CHECK (
    (
      "provider_state" = 'needs_sync'
      AND "provider_clerk_user_id" IS NULL
      AND "clerk_instance_id" IS NULL
      AND "provider_updated_at" IS NULL
      AND "last_webhook_event_id" IS NULL
      AND "synced_at" IS NULL
    ) OR (
      "provider_state" <> 'needs_sync'
      AND "provider_clerk_user_id" IS NOT NULL
      AND "clerk_instance_id" IS NOT NULL
      AND "provider_updated_at" IS NOT NULL
      AND "last_webhook_event_id" IS NOT NULL
      AND "synced_at" IS NOT NULL
    )
  );

CREATE UNIQUE INDEX "registered_accounts_provider_identity_unique"
  ON "registered_accounts" ("clerk_instance_id", "provider_clerk_user_id")
  WHERE "clerk_instance_id" IS NOT NULL AND "provider_clerk_user_id" IS NOT NULL;

-- The two receipt tables are append-only. Disable only their named guards for
-- the one deterministic backfill, then restore the guards before continuing.
ALTER TABLE "clerk_user_sync_receipts"
  ADD COLUMN "canonical_clerk_user_id" text;
ALTER TABLE "clerk_user_sync_receipts"
  DISABLE TRIGGER "clerk_user_sync_receipts_append_only";
UPDATE "clerk_user_sync_receipts"
  SET "canonical_clerk_user_id" = "clerk_user_id";
ALTER TABLE "clerk_user_sync_receipts"
  ENABLE TRIGGER "clerk_user_sync_receipts_append_only";
ALTER TABLE "clerk_user_sync_receipts"
  ALTER COLUMN "canonical_clerk_user_id" SET NOT NULL,
  DROP CONSTRAINT "clerk_user_sync_receipts_shape";
ALTER TABLE "clerk_user_sync_receipts"
  ADD CONSTRAINT "clerk_user_sync_receipts_shape" CHECK (
    NULLIF(btrim("event_id"), '') IS NOT NULL
    AND char_length("event_id") <= 255
    AND "event_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "event_type" IN ('user.created', 'user.updated', 'user.deleted')
    AND "clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
    AND "canonical_clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
    AND "clerk_instance_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
  );
CREATE INDEX "clerk_user_sync_receipts_canonical_user_idx"
  ON "clerk_user_sync_receipts" (
    "canonical_clerk_user_id",
    "provider_updated_at" DESC,
    "event_id"
  );

ALTER TABLE "producer_invitation_grants"
  ADD COLUMN "provider_clerk_user_id" text;
ALTER TABLE "producer_invitation_grants"
  DISABLE TRIGGER "producer_invitation_grants_append_only";
UPDATE "producer_invitation_grants"
  SET "provider_clerk_user_id" = "clerk_user_id";
ALTER TABLE "producer_invitation_grants"
  ENABLE TRIGGER "producer_invitation_grants_append_only";
ALTER TABLE "producer_invitation_grants"
  ALTER COLUMN "provider_clerk_user_id" SET NOT NULL,
  DROP CONSTRAINT "producer_invitation_grants_identity_shape";
ALTER TABLE "producer_invitation_grants"
  ADD CONSTRAINT "producer_invitation_grants_identity_shape" CHECK (
    "clerk_invitation_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
    AND "clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
    AND "provider_clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
    AND "clerk_instance_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
    AND "invited_email_hash" ~ '^[0-9a-f]{64}$'
  );
