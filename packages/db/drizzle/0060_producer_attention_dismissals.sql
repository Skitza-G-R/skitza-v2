-- SK-284: let a producer hide a nagging "Needs you" row without pretending the
-- underlying work is done.
--
-- Same self-healing shape as 0053's booking_calendar_links.attention_dismissed_at:
-- we store a TIMESTAMP, not a boolean. A row is hidden only while
--   dismissed_at >= <the subject's last-changed time>
-- so the moment the subject changes again — another session finishes, a new
-- upload lands, the artist writes again — the row reappears on its own. Nothing
-- else in the app has to remember to un-hide it.
--
-- Only the three deadline-free rows are dismissible. Money and time-boxed
-- decisions (payment proofs, payment due, purchase requests, session requests)
-- are deliberately excluded at the DB level so a future caller cannot hide them.
--
-- Additive only: new table, no existing rows touched.

CREATE TABLE IF NOT EXISTS "producer_attention_dismissals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "producer_id" uuid NOT NULL,
  "item_kind" text NOT NULL,
  -- Project id for follow_up and urgent_project; comment id for comment.
  "subject_id" uuid NOT NULL,
  "dismissed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "producer_attention_dismissals_kind_allowed"
    CHECK ("item_kind" IN ('follow_up', 'comment', 'urgent_project')),
  CONSTRAINT "producer_attention_dismissals_timestamp_shape"
    CHECK ("dismissed_at" >= "created_at")
);

-- One dismissal per producer per subject per kind. urgent_project and follow_up
-- are two different rows about the same project, so the kind has to be part of
-- the key. Re-dismissing bumps dismissed_at through ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS "producer_attention_dismissals_subject_unique"
  ON "producer_attention_dismissals" ("producer_id", "item_kind", "subject_id");

-- The dashboard reads every dismissal for one producer on each render.
CREATE INDEX IF NOT EXISTS "producer_attention_dismissals_producer_idx"
  ON "producer_attention_dismissals" ("producer_id");
