-- ─── Rename projects → deals + add stage/client cache ──────────────
-- Hand-edited from the drizzle-kit generate output so the column
-- `project_tracks.project_id` → `deal_tracks.deal_id` lands as a
-- data-preserving RENAME instead of the generator's default
-- add-new-column + drop-old-column pair (which would wipe every
-- existing row's link to its parent). Drizzle picks up the correct
-- final shape from 0008_snapshot.json — the SQL body just has to
-- arrive at the same shape.
--
-- Scope:
-- 1. Create deal_stage enum.
-- 2. Rename tables projects → deals, project_tracks → deal_tracks.
-- 3. Rename FK column project_tracks.project_id → deal_tracks.deal_id.
-- 4. Add bookings.deal_id (new nullable FK).
-- 5. Add deals.stage / client_name / client_email.
-- 6. Re-bind FK constraints to the new table names (Drizzle renamed
--    its own constraint identifiers; Postgres would otherwise keep
--    the legacy "projects_*" constraint names).

CREATE TYPE "public"."deal_stage" AS ENUM('lead', 'booked', 'contract_sent', 'in_production', 'final_review', 'paid', 'archived');--> statement-breakpoint
ALTER TABLE "project_tracks" RENAME TO "deal_tracks";--> statement-breakpoint
ALTER TABLE "projects" RENAME TO "deals";--> statement-breakpoint
ALTER TABLE "deal_tracks" RENAME COLUMN "project_id" TO "deal_id";--> statement-breakpoint
ALTER TABLE "deals" DROP CONSTRAINT "projects_share_token_hash_unique";--> statement-breakpoint
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "deal_tracks" DROP CONSTRAINT "project_tracks_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "deals" DROP CONSTRAINT "projects_producer_id_producers_id_fk";--> statement-breakpoint
ALTER TABLE "deals" DROP CONSTRAINT "projects_booking_id_bookings_id_fk";--> statement-breakpoint
ALTER TABLE "track_versions" DROP CONSTRAINT "track_versions_track_id_project_tracks_id_fk";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "deal_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "stage" "deal_stage" DEFAULT 'lead' NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "client_name" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "client_email" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_project_id_deals_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_tracks" ADD CONSTRAINT "deal_tracks_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "track_versions" ADD CONSTRAINT "track_versions_track_id_deal_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."deal_tracks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_share_token_hash_unique" UNIQUE("share_token_hash");
