-- 0018_producer_tax_mode.sql
--
-- Business-level VAT / tax disclosure mode on producers.
--
-- Three modes for v1:
--   * 'none'         — no tax line. Default for non-IL producers + all
--                      existing rows (which is why we bake the default
--                      in rather than ALTER-COLUMN-DEFAULT later).
--   * 'vat_included' — listed prices already include 18% VAT. UI
--                      renders an "Includes 18% VAT" footnote on every
--                      product surface. No math change.
--   * 'vat_exempt'   — Osek Patur (small-business exempt). UI renders
--                      an "Exempt from VAT (Osek Patur)" footnote. No
--                      math change.
--
-- Free-text on disk (not a pgEnum) so adding 'vat_added' later — the
-- B2B / +VAT-at-checkout mode that DOES change checkout totals — is
-- a single-row UPDATE rather than a CREATE TYPE ... AS ENUM dance.
--
-- The displayed price = the price the artist pays in all three modes.
-- Only the disclosure label differs.

ALTER TABLE "producers"
  ADD COLUMN IF NOT EXISTS "tax_mode" TEXT NOT NULL DEFAULT 'none';
