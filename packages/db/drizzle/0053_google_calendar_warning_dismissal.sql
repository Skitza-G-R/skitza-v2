-- SK-247: let a Producer dismiss a stale attention row without claiming the
-- underlying Google event is synced. A later sync-state transition gets a
-- newer sync_state_changed_at value and makes the warning visible again.

ALTER TABLE "booking_calendar_links"
  ADD COLUMN "attention_dismissed_at" timestamp with time zone;

ALTER TABLE "booking_calendar_links"
  ADD CONSTRAINT "booking_calendar_links_attention_dismissed_timestamp_shape"
  CHECK (
    "attention_dismissed_at" IS NULL
    OR "attention_dismissed_at" >= "created_at"
  );
