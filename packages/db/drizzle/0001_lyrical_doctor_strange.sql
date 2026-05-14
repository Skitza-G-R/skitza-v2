ALTER TABLE "projects" ADD COLUMN "invite_token" text;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_invite_token_unique" UNIQUE("invite_token");