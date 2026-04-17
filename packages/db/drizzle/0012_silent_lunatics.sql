-- Booking v2 — extend packages with classification + policy columns and
-- add the availability_blackouts table. Pure additive migration: no
-- drops, renames, or NOT-NULL columns without defaults, so existing
-- rows keep working.
BEGIN;

-- New columns on packages. All NOT NULL with defaults matching the
-- drizzle schema so pre-existing rows get sensible values ("session",
-- "studio", 0 buffer, 12h lead).
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'session' NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "location_type" text DEFAULT 'studio' NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "buffer_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "min_lead_hours" integer DEFAULT 12 NOT NULL;--> statement-breakpoint

-- Blackouts table. `start_date`/`end_date` are YYYY-MM-DD text (calendar
-- days in the producer's TZ) rather than timestamps — the range is a
-- conceptual "these days" span, not a specific UTC instant.
CREATE TABLE IF NOT EXISTS "availability_blackouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producer_id" uuid NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "availability_blackouts" ADD CONSTRAINT "availability_blackouts_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Covers the common lookup: "all blackouts for producer X, sorted by
-- start date". Matches blackouts.list's ORDER BY asc(start_date).
CREATE INDEX IF NOT EXISTS "availability_blackouts_producer_start_idx" ON "availability_blackouts" ("producer_id","start_date");

COMMIT;
