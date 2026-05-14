CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."external_platform" AS ENUM('spotify', 'apple_music', 'youtube', 'soundcloud', 'bandcamp', 'tidal', 'instagram_reels');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'paid', 'refunded', 'void', 'uncollectible');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('comment_created', 'booking_requested', 'track_approved');--> statement-breakpoint
CREATE TYPE "public"."project_stage" AS ENUM('lead', 'booked', 'in_production', 'final_review', 'paid', 'archived');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "availability_blackouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producer_id" uuid NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "availability_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producer_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_min" integer NOT NULL,
	"end_min" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producer_id" uuid NOT NULL,
	"product_id" uuid,
	"package_name_snapshot" text,
	"project_id" uuid,
	"artist_name" text NOT NULL,
	"artist_email" text NOT NULL,
	"artist_phone" text,
	"notes" text,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_min" integer NOT NULL,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"status_changed_at" timestamp with time zone,
	"reminder_sent_24h" timestamp with time zone,
	"reminder_sent_1h" timestamp with time zone,
	"stripe_checkout_session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producer_id" uuid NOT NULL,
	"email_hash" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"referral_source" text,
	"clerk_user_id" text,
	CONSTRAINT "client_contacts_producer_email_unique" UNIQUE("producer_id","email_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producer_id" uuid NOT NULL,
	"project_id" uuid,
	"booking_id" uuid,
	"payment_plan_project_id" uuid,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"customer_email" text,
	"customer_name" text,
	"paid_at" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producer_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"project_id" uuid,
	"track_version_id" uuid,
	"comment_id" uuid,
	"booking_id" uuid,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producer_id" uuid NOT NULL,
	"title" text NOT NULL,
	"artist" text,
	"audio_url" text,
	"artwork_url" text,
	"position" integer DEFAULT 0 NOT NULL,
	"audio_r2_key" text,
	"size_bytes" bigint,
	"duration_ms" integer,
	"peaks_r2_key" text,
	"is_public_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "producer_external_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producer_id" uuid NOT NULL,
	"platform" "external_platform" NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "producer_external_links_producer_platform_unique" UNIQUE("producer_id","platform")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "producer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producer_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"stripe_charges_enabled" boolean DEFAULT false NOT NULL,
	"default_session_min" integer DEFAULT 60 NOT NULL,
	"auto_confirm_bookings" boolean DEFAULT false NOT NULL,
	"cancellation_policy_hours" integer DEFAULT 24 NOT NULL,
	"autopilot_welcome_email" boolean DEFAULT false NOT NULL,
	"autopilot_unpaid_reminder" boolean DEFAULT false NOT NULL,
	"autopilot_request_testimonial" boolean DEFAULT false NOT NULL,
	"autopilot_comment_notify" boolean DEFAULT true NOT NULL,
	"autopilot_auto_archive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "producers_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "producers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_min" integer NOT NULL,
	"session_count" integer DEFAULT 1 NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"deposit_pct" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"kind" text DEFAULT 'session' NOT NULL,
	"location_type" text DEFAULT 'studio' NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"min_lead_hours" integer DEFAULT 12 NOT NULL,
	"pricing_model" text DEFAULT 'flat' NOT NULL,
	"volume_tiers" jsonb,
	"hourly_rate_cents" integer,
	"deliverables" text[],
	"deposit_model" text DEFAULT 'flat' NOT NULL,
	"milestones" jsonb,
	"archived_at" timestamp with time zone,
	"payment_plans" jsonb DEFAULT '[{"kind":"full"}]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"artist" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producer_id" uuid NOT NULL,
	"booking_id" uuid,
	"title" text NOT NULL,
	"stage" "project_stage" DEFAULT 'lead' NOT NULL,
	"client_name" text,
	"client_email" text,
	"artist_name" text NOT NULL,
	"artist_email" text NOT NULL,
	"deposit_paid" boolean DEFAULT false NOT NULL,
	"final_paid" boolean DEFAULT false NOT NULL,
	"payment_plan_kind" text,
	"installments" integer,
	"stripe_customer_id" text,
	"stripe_payment_method_id" text,
	"stripe_subscription_schedule_id" text,
	"charges_completed" integer DEFAULT 0 NOT NULL,
	"charges_total" integer,
	"total_amount_cents" integer,
	"currency" text,
	"next_charge_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"testimonial_requested_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stripe_customers" (
	"producer_id" uuid NOT NULL,
	"client_contact_id" uuid NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_customers_producer_id_client_contact_id_pk" PRIMARY KEY("producer_id","client_contact_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "track_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"author_email" text NOT NULL,
	"body" text NOT NULL,
	"timestamp_ms" integer NOT NULL,
	"resolved_at" timestamp with time zone,
	"from_producer" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "track_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"label" text NOT NULL,
	"audio_url" text,
	"duration_ms" integer,
	"audio_r2_key" text,
	"size_bytes" bigint,
	"peaks_r2_key" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "availability_blackouts" ADD CONSTRAINT "availability_blackouts_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_plan_project_id_projects_id_fk" FOREIGN KEY ("payment_plan_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_track_version_id_track_versions_id_fk" FOREIGN KEY ("track_version_id") REFERENCES "public"."track_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_comment_id_track_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."track_comments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portfolio_tracks" ADD CONSTRAINT "portfolio_tracks_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "producer_external_links" ADD CONSTRAINT "producer_external_links_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "producer_notes" ADD CONSTRAINT "producer_notes_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "products" ADD CONSTRAINT "products_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_tracks" ADD CONSTRAINT "project_tracks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stripe_customers" ADD CONSTRAINT "stripe_customers_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stripe_customers" ADD CONSTRAINT "stripe_customers_client_contact_id_client_contacts_id_fk" FOREIGN KEY ("client_contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "track_comments" ADD CONSTRAINT "track_comments_version_id_track_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."track_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "track_versions" ADD CONSTRAINT "track_versions_track_id_project_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."project_tracks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "availability_blackouts_producer_start_idx" ON "availability_blackouts" USING btree ("producer_id","start_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_contacts_clerk_user_idx" ON "client_contacts" USING btree ("clerk_user_id") WHERE "client_contacts"."clerk_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_producer_created_idx" ON "invoices" USING btree ("producer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_stripe_payment_intent_unique" ON "invoices" USING btree ("stripe_payment_intent_id") WHERE "invoices"."stripe_payment_intent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_producer_active_idx" ON "notifications" USING btree ("producer_id","archived_at","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "producer_external_links_producer_idx" ON "producer_external_links" USING btree ("producer_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "producer_notes_producer_created_idx" ON "producer_notes" USING btree ("producer_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stripe_customers_customer_idx" ON "stripe_customers" USING btree ("stripe_customer_id");