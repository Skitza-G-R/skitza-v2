-- Settings redesign — new producer columns.
-- Design: docs/plans/active/2026-05-14-settings-redesign-design.md
-- All additive, all idempotent.
--
-- Three new columns on producers:
--   plan                — 'free' | 'pro'  (UI-only for v1; real billing later)
--   week_start          — 'sun' | 'mon'   (Calendar week-grid orientation)
--   notification_prefs  — jsonb           (per-event email/in-app toggle map)

ALTER TABLE producers
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free';

ALTER TABLE producers
  ADD COLUMN IF NOT EXISTS week_start text NOT NULL DEFAULT 'sun';

ALTER TABLE producers
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
