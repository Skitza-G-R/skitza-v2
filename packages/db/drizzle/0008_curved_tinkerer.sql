-- Phase B.2 hard-cut: drop the old markdown-contracts schema and replace
-- with the PDF-editor schema (contracts + contract_recipients +
-- contract_fields + contract_events). PDF templates ARE contracts in
-- draft state; no separate templates table.
BEGIN;

-- Drop old tables (CASCADE nukes dependent FKs on contracts/contract_events).
DROP TABLE IF EXISTS "contract_events" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "contracts" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "contract_templates" CASCADE;--> statement-breakpoint

-- Drop old enums that the old tables referenced.
DROP TYPE IF EXISTS "public"."contract_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."contract_event_kind";--> statement-breakpoint

-- New enums.
CREATE TYPE "public"."contract_status" AS ENUM('draft', 'sent', 'viewed', 'signed', 'completed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."contract_field_type" AS ENUM('signature', 'initial', 'date', 'text', 'checkbox', 'dropdown', 'number');--> statement-breakpoint
CREATE TYPE "public"."contract_event_kind" AS ENUM('created', 'sent', 'viewed', 'field_filled', 'signed', 'completed', 'cancelled', 'downloaded');--> statement-breakpoint

-- New tables.
CREATE TABLE IF NOT EXISTS "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"producer_id" uuid NOT NULL,
	"deal_id" uuid,
	"title" text NOT NULL,
	"pdf_r2_key" text NOT NULL,
	"final_pdf_r2_key" text,
	"status" "contract_status" DEFAULT 'draft' NOT NULL,
	"share_token_hash" text,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_share_token_hash_unique" UNIQUE("share_token_hash")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "contract_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'signer' NOT NULL,
	"routing_order" integer DEFAULT 1 NOT NULL,
	"signing_token_hash" text NOT NULL,
	"viewed_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_recipients_signing_token_hash_unique" UNIQUE("signing_token_hash")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "contract_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"recipient_id" uuid,
	"page" integer NOT NULL,
	"x" numeric(5, 2) NOT NULL,
	"y" numeric(5, 2) NOT NULL,
	"w" numeric(5, 2) NOT NULL,
	"h" numeric(5, 2) NOT NULL,
	"type" "contract_field_type" NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"prefilled_value" text,
	"signed_value" text,
	"signed_at" timestamp with time zone,
	"options" jsonb
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "contract_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"recipient_id" uuid,
	"event" "contract_event_kind" NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- FKs.
DO $$ BEGIN
 ALTER TABLE "contracts" ADD CONSTRAINT "contracts_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_recipients" ADD CONSTRAINT "contract_recipients_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_fields" ADD CONSTRAINT "contract_fields_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_fields" ADD CONSTRAINT "contract_fields_recipient_id_contract_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."contract_recipients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_recipient_id_contract_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."contract_recipients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

COMMIT;
