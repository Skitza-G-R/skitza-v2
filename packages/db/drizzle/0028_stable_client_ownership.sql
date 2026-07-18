-- SK-91: stable client ownership and historical deletion safety.
-- This migration is schema-only. It does not reset, rewrite, or infer data.

ALTER TABLE "client_contacts"
  ADD COLUMN "producer_archived_at" timestamp with time zone;

CREATE OR REPLACE FUNCTION "skitza_guard_client_contact_owner"()
RETURNS trigger AS $function$
BEGIN
  IF NEW."producer_id" IS DISTINCT FROM OLD."producer_id"
    OR (
      OLD."clerk_user_id" IS NOT NULL
      AND NEW."clerk_user_id" IS DISTINCT FROM OLD."clerk_user_id"
    )
  THEN
    RAISE EXCEPTION 'SKITZA_CLIENT_OWNER_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "client_contacts_owner_immutable"
BEFORE UPDATE OF "producer_id", "clerk_user_id" ON "client_contacts"
FOR EACH ROW EXECUTE FUNCTION "skitza_guard_client_contact_owner"();

CREATE OR REPLACE FUNCTION "skitza_guard_project_owner"()
RETURNS trigger AS $function$
BEGIN
  IF NEW."producer_id" IS DISTINCT FROM OLD."producer_id"
    OR NEW."client_contact_id" IS DISTINCT FROM OLD."client_contact_id"
  THEN
    RAISE EXCEPTION 'SKITZA_PROJECT_CLIENT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "projects_owner_immutable"
BEFORE UPDATE OF "producer_id", "client_contact_id" ON "projects"
FOR EACH ROW EXECUTE FUNCTION "skitza_guard_project_owner"();

CREATE OR REPLACE FUNCTION "skitza_guard_client_contact_delete"()
RETURNS trigger AS $function$
BEGIN
  IF OLD."clerk_user_id" IS NOT NULL
    OR OLD."invited_at" IS NOT NULL
    OR OLD."archived_at" IS NOT NULL
    OR OLD."producer_archived_at" IS NOT NULL
  THEN
    RAISE EXCEPTION 'SKITZA_CLIENT_NOT_EMPTY_DRAFT';
  END IF;

  IF EXISTS (
      SELECT 1 FROM "projects"
      WHERE "producer_id" = OLD."producer_id" AND "client_contact_id" = OLD."id"
    ) OR EXISTS (
      SELECT 1 FROM "purchase_requests"
      WHERE "producer_id" = OLD."producer_id" AND "client_contact_id" = OLD."id"
    ) OR EXISTS (
      SELECT 1 FROM "private_offers"
      WHERE "producer_id" = OLD."producer_id" AND "client_contact_id" = OLD."id"
    ) OR EXISTS (
      SELECT 1 FROM "purchases"
      WHERE "producer_id" = OLD."producer_id" AND "client_contact_id" = OLD."id"
    ) OR EXISTS (
      SELECT 1 FROM "purchase_acceptances"
      WHERE "producer_id" = OLD."producer_id" AND "client_contact_id" = OLD."id"
    ) OR EXISTS (
      SELECT 1 FROM "payment_proofs"
      WHERE "producer_id" = OLD."producer_id" AND "client_contact_id" = OLD."id"
    ) OR EXISTS (
      SELECT 1 FROM "version_approval_events"
      WHERE "producer_id" = OLD."producer_id" AND "client_contact_id" = OLD."id"
    )
  THEN
    RAISE EXCEPTION 'SKITZA_CLIENT_HISTORY_EXISTS';
  END IF;

  RETURN OLD;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "client_contacts_empty_draft_delete_only"
BEFORE DELETE ON "client_contacts"
FOR EACH ROW EXECUTE FUNCTION "skitza_guard_client_contact_delete"();

CREATE OR REPLACE FUNCTION "skitza_guard_project_delete"()
RETURNS trigger AS $function$
BEGIN
  IF OLD."lifecycle_status" <> 'waiting_for_payment' THEN
    RAISE EXCEPTION 'SKITZA_PROJECT_NOT_EMPTY_DRAFT';
  END IF;

  IF EXISTS (
      SELECT 1 FROM "project_tracks" WHERE "project_id" = OLD."id"
    ) OR EXISTS (
      SELECT 1 FROM "purchases"
      WHERE "producer_id" = OLD."producer_id" AND "project_id" = OLD."id"
    ) OR EXISTS (
      SELECT 1 FROM "purchase_requests"
      WHERE "producer_id" = OLD."producer_id" AND "project_id" = OLD."id"
    ) OR EXISTS (
      SELECT 1 FROM "private_offers"
      WHERE "producer_id" = OLD."producer_id" AND "target_project_id" = OLD."id"
    ) OR EXISTS (
      SELECT 1 FROM "bookings"
      WHERE "producer_id" = OLD."producer_id" AND "project_id" = OLD."id"
    ) OR EXISTS (
      SELECT 1 FROM "notifications"
      WHERE "producer_id" = OLD."producer_id" AND "project_id" = OLD."id"
    )
  THEN
    RAISE EXCEPTION 'SKITZA_PROJECT_HISTORY_EXISTS';
  END IF;

  RETURN OLD;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "projects_empty_draft_delete_only"
BEFORE DELETE ON "projects"
FOR EACH ROW EXECUTE FUNCTION "skitza_guard_project_delete"();
