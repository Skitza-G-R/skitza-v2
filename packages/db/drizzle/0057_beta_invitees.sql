-- SK-273: founder-only closed-beta invite tracker. The admin console imports
-- the beta email list here, releases Clerk invitation waves from it, and a
-- daily cron nudges people who stall. Statuses move forward only:
--   pending -> invited -> signed_up -> active
-- The *_sent_at stamps make each automated nudge one-shot.
--
-- Additive only: new table, no existing rows touched.

CREATE TABLE IF NOT EXISTS "beta_invitees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "wave" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'pending',
  "invited_at" timestamp with time zone,
  "signed_up_at" timestamp with time zone,
  "activated_at" timestamp with time zone,
  "signup_reminder_sent_at" timestamp with time zone,
  "activation_help_sent_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "beta_invitees_status_allowed"
    CHECK ("status" IN ('pending', 'invited', 'signed_up', 'active')),
  CONSTRAINT "beta_invitees_email_lowercase" CHECK ("email" = lower("email")),
  CONSTRAINT "beta_invitees_wave_positive" CHECK ("wave" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "beta_invitees_email_unique" ON "beta_invitees" ("email");
CREATE INDEX IF NOT EXISTS "beta_invitees_status_idx" ON "beta_invitees" ("status");
CREATE INDEX IF NOT EXISTS "beta_invitees_wave_idx" ON "beta_invitees" ("wave");
