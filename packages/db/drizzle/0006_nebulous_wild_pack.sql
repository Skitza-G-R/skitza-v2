ALTER TABLE "portfolio_tracks" ADD COLUMN "audio_r2_key" text;--> statement-breakpoint
ALTER TABLE "portfolio_tracks" ADD COLUMN "size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "portfolio_tracks" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "portfolio_tracks" ADD COLUMN "peaks_r2_key" text;--> statement-breakpoint
ALTER TABLE "track_versions" ADD COLUMN "audio_r2_key" text;--> statement-breakpoint
ALTER TABLE "track_versions" ADD COLUMN "size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "track_versions" ADD COLUMN "peaks_r2_key" text;