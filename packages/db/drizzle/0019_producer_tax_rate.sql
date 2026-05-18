-- 0019_producer_tax_rate.sql
--
-- Tax v2 — the disclosure picker becomes a real toggle with 3 modes
-- and an editable rate. Replaces migration 0018's design.
--
-- Mode changes:
--   none          → tax_free      (consolidated — was "no tax line")
--   vat_exempt    → tax_free      (Osek Patur folds into the same
--                                  user-facing mode; producers who
--                                  want the legal "Exempt" copy still
--                                  show the same tax-free footnote)
--   vat_included  → tax_included  (unchanged semantics, new label)
--   (new)         → tax_added     (NEW — actually multiplies the
--                                  checkout total by 1 + rate/100)
--
-- New column:
--   tax_rate_pct  INTEGER NOT NULL DEFAULT 18 — the % the producer
--                                  declares. Default 18 matches the
--                                  Israeli VAT rate (Skitza's primary
--                                  market). Non-IL producers pick
--                                  tax_free and the rate becomes
--                                  irrelevant; UK / EU producers can
--                                  edit to 20-25; US producers
--                                  typically tax_free at the platform
--                                  level (state tax is out-of-scope).
--
-- The math impact is in apps/web/src/lib/tax-mode.ts (helpers) and
-- apps/web/src/server/payments/checkout-initiator.ts (Stripe charge
-- amount). See those files for the read-side wiring.

ALTER TABLE "producers"
  ADD COLUMN IF NOT EXISTS "tax_rate_pct" INTEGER NOT NULL DEFAULT 18;

UPDATE "producers" SET "tax_mode" = 'tax_free'      WHERE "tax_mode" IN ('none', 'vat_exempt');
UPDATE "producers" SET "tax_mode" = 'tax_included'  WHERE "tax_mode" = 'vat_included';
