-- SK-229: a Producer role may be created only from an accepted Clerk
-- application invitation. This append-only receipt claims the provider
-- invitation once and binds it to the exact Clerk instance, Clerk user, and
-- verified email identity used for the grant.

CREATE TABLE "producer_invitation_grants" (
  "clerk_invitation_id" text PRIMARY KEY,
  "clerk_user_id" text NOT NULL,
  "clerk_instance_id" text NOT NULL,
  "invited_email_hash" text NOT NULL,
  "invitation_created_at" timestamp with time zone NOT NULL,
  "provider_updated_at" timestamp with time zone NOT NULL,
  "granted_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "producer_invitation_grants_clerk_user_unique"
    UNIQUE ("clerk_user_id"),
  CONSTRAINT "producer_invitation_grants_identity_shape"
    CHECK (
      "clerk_invitation_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      AND "clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      AND "clerk_instance_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
      AND "invited_email_hash" ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT "producer_invitation_grants_timestamp_shape"
    CHECK ("provider_updated_at" >= "invitation_created_at")
);

CREATE TRIGGER "producer_invitation_grants_append_only"
  BEFORE UPDATE OR DELETE ON "producer_invitation_grants"
  FOR EACH ROW
  EXECUTE FUNCTION "prevent_append_only_mutation"();
