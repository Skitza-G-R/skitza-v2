CREATE TABLE IF NOT EXISTS "producers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"slug" text NOT NULL,
	"brand" jsonb DEFAULT '{}'::jsonb,
	"default_currency" text DEFAULT 'USD' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"stripe_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "producers_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "producers_slug_unique" UNIQUE("slug")
);
