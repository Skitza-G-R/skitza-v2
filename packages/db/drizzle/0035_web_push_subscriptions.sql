-- SK-112: additive, account-owned multi-device Web Push subscriptions.
-- This migration does not enable any category for existing users and does
-- not rewrite existing tables. The application computes endpoint_hash as
-- `sha256:<lowercase hex>` and rejects attempts to reuse a live endpoint
-- owned by another Clerk account.

CREATE TABLE "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clerk_user_id" text NOT NULL,
  "endpoint" text NOT NULL,
  "endpoint_hash" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "categories" text[] DEFAULT '{}'::text[] NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "push_subscriptions_endpoint_hash_unique" UNIQUE ("endpoint_hash"),
  CONSTRAINT "push_subscriptions_id_owner_unique" UNIQUE ("id", "clerk_user_id"),
  CONSTRAINT "push_subscriptions_endpoint_https"
    CHECK ("endpoint" ~ '^https://[^[:space:]]+$'),
  CONSTRAINT "push_subscriptions_endpoint_hash_shape"
    CHECK ("endpoint_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "push_subscriptions_key_shape"
    CHECK (
      char_length("p256dh") BETWEEN 32 AND 256
      AND char_length("auth") BETWEEN 8 AND 128
    ),
  CONSTRAINT "push_subscriptions_categories_allowlist"
    CHECK (
      "categories" <@ ARRAY[
        'booking',
        'payment',
        'comment',
        'project_status',
        'song_status',
        'purchase_status'
      ]::text[]
    ),
  CONSTRAINT "push_subscriptions_future_expiry"
    CHECK ("expires_at" IS NULL OR "expires_at" > "created_at")
);

CREATE INDEX "push_subscriptions_owner_updated_idx"
  ON "push_subscriptions" ("clerk_user_id", "updated_at");

CREATE INDEX "push_subscriptions_expires_idx"
  ON "push_subscriptions" ("expires_at")
  WHERE "expires_at" IS NOT NULL;
