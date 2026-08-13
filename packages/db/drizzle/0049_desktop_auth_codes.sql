-- SK-232: durable, one-use authorization-code replay protection for the
-- desktop system-browser social sign-in handoff. This table deliberately
-- contains no raw authorization code, PKCE verifier, state value, Clerk
-- ticket, cookie, or session token.

CREATE TABLE "desktop_auth_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code_digest" text NOT NULL,
  "state_digest" text NOT NULL,
  "producer_id" uuid NOT NULL,
  "pkce_challenge" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "desktop_auth_codes_code_digest_unique" UNIQUE("code_digest"),
  CONSTRAINT "desktop_auth_codes_producer_fk"
    FOREIGN KEY ("producer_id") REFERENCES "producers"("id")
    ON DELETE CASCADE,
  CONSTRAINT "desktop_auth_codes_code_digest_shape"
    CHECK ("code_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "desktop_auth_codes_state_digest_shape"
    CHECK ("state_digest" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "desktop_auth_codes_pkce_challenge_shape"
    CHECK ("pkce_challenge" ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT "desktop_auth_codes_lifetime_shape" CHECK ((
    "expires_at" > "created_at"
    AND "expires_at" <= "created_at" + interval '60 seconds'
    AND (
      "consumed_at" IS NULL
      OR (
        "consumed_at" >= "created_at"
        AND "consumed_at" < "expires_at"
      )
    )
  ) IS TRUE)
);

CREATE INDEX "desktop_auth_codes_expires_idx"
  ON "desktop_auth_codes" ("expires_at", "id");

-- Every identity/binding field is immutable. The only permitted update is
-- the first successful NULL -> consumed_at transition before expiry.
CREATE FUNCTION "consume_desktop_auth_code_once"()
RETURNS trigger AS $function$
BEGIN
  IF ROW(
    OLD."id",
    OLD."code_digest",
    OLD."state_digest",
    OLD."producer_id",
    OLD."pkce_challenge",
    OLD."expires_at",
    OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id",
    NEW."code_digest",
    NEW."state_digest",
    NEW."producer_id",
    NEW."pkce_challenge",
    NEW."expires_at",
    NEW."created_at"
  ) OR OLD."consumed_at" IS NOT NULL OR NEW."consumed_at" IS NULL
    OR NEW."consumed_at" < NEW."created_at"
    OR NEW."consumed_at" >= NEW."expires_at"
  THEN
    RAISE EXCEPTION 'SKITZA_DESKTOP_AUTH_CODE_IMMUTABLE_OR_CONSUMED';
  END IF;

  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER "desktop_auth_codes_consume_once"
  BEFORE UPDATE ON "desktop_auth_codes"
  FOR EACH ROW
  EXECUTE FUNCTION "consume_desktop_auth_code_once"();
