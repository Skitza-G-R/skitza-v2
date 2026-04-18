-- Phase H.3 — rebuild `packages` into a proper `products` store.
-- Second rename in the booking surface (after packages→sessions, now
-- packages→products). Uses ALTER TABLE … RENAME TO + RENAME COLUMN so
-- every row, index, and FK constraint is preserved — including all
-- existing bookings, which keep their product_id (was package_id).
--
-- New columns model the pricing + deposit shapes producers actually
-- sell: flat (one price), per-song volume tiers, hourly rate, bundle
-- sessions, plus milestone-based deposits and a deliverables chip
-- list. All new columns have safe defaults so existing rows keep
-- working as flat-priced products with no migration of data required.
BEGIN;

ALTER TABLE "packages" RENAME TO "products";
ALTER TABLE "bookings" RENAME COLUMN "package_id" TO "product_id";

-- Pricing shape: 'flat' | 'per_song' | 'hourly' | 'bundle'.
-- Existing rows default to 'flat' so they continue to read as single-
-- price products.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "pricing_model" text NOT NULL DEFAULT 'flat';

-- Volume tier table for per-song pricing. Array of
-- [{ minQty, pricePerUnitCents }] sorted ascending by minQty. Null
-- for non-per-song products.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "volume_tiers" jsonb;

-- Hourly rate (cents) for hourly products. Null for the rest.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "hourly_rate_cents" integer;

-- Deliverables chip list — "Mixed master", "Stems", "Credit". Stored
-- as a text array so we can render chips directly without a join.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "deliverables" text[];

-- Deposit shape: 'flat' (single % upfront), 'milestones' (multiple
-- named percent rows summing to 100), 'paid_in_full' (no deposit).
-- Defaults to 'flat' so the existing depositPct column continues to
-- drive pricing.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "deposit_model" text NOT NULL DEFAULT 'flat';

-- Milestone schedule when deposit_model = 'milestones'. Array of
-- [{ label, pct }]. Null otherwise.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "milestones" jsonb;

-- Soft-delete timestamp for products no longer offered. Null = live.
-- (Complements the existing `active` boolean — `archived_at` is the
-- newer Phase H shape; `active` stays for back-compat until we remove
-- it in a later pass.)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;

COMMIT;
