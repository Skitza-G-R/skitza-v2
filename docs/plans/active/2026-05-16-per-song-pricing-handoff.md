# Per-Song Pricing — Handoff

**Date:** 2026-05-16
**Branch:** `per-song-pricing-design`
**PR:** [#134](https://github.com/Skitza-G-R/skitza-v2/pull/134) (against `v3-clean`)
**Worktree:** `/Users/giliasraf/skitza-per-song-pricing` (clone of main repo pinned to this branch — main repo at `/Users/giliasraf/Skitza 16.4` is free for other work)
**Status:** Code done, tests green, PR awaiting smoke test. **One database migration step blocks the preview from working.**

---

## TL;DR for whoever picks this up

Adds **per-song pricing** to Skitza storefront products. One product (e.g. "Mixing") can now be sold for any number of songs with optional tier discounts. Producer toggles "Per song" in the wizard, sets a base price + a discount ladder. Artist sees "From $X/song" on the store card, taps a `– / +` stepper on the detail page to pick the count, then checks out. Producer dashboard shows "Mixing × 5 songs" on the resulting project.

**The single blocker before the preview works:** apply two SQL migrations (`0015` + `0016`) to the production Neon DB. Both add nullable columns only — totally safe, fully idempotent.

---

## What's complete (13 commits, 2417 tests passing)

### Math foundation
- `apps/web/src/lib/pricing.ts` — pure helpers `unitPriceFor`, `totalFor`, `fromPrice`, `validateTiers`. Single source for all tier math. 17 tests.

### Producer wizard
- `(producer)/dashboard/store/editor-steps/pricing-step.tsx` — segmented pill toggle between "One flat price" and "Per song with discounts". Per-song panel is a 3-column rate-card ladder (when booking · per song · total) with an "Artists will see" preview that renders the **exact** store-card copy the artist will read.
- `(producer)/dashboard/store/product-editor.tsx` — Draft interface extended.
- `(producer)/dashboard/store/build-package-payload.ts` — pure extracted helper for the wizard save path. 11 tests on the Draft → wire mapping.
- `(producer)/dashboard/booking/actions.ts` — server actions accept `pricingModel` + `volumeTiers` and pass through to tRPC.

### Artist surface
- `components/artist/store/product-card.tsx` — renders "From $X/song · Discounts for bigger projects" when the product is per-song. Uses `fromPrice()` so the producer's preview and the artist card never drift.
- `server/trpc/routers/artist.ts` — `store.products` query lists flat + per_song (hourly + bundle stay hidden). Both queries select `volumeTiers`.
- `(artist)/artist/store/[productId]/song-count-stepper.tsx` — `– / +` picker with live total + "save $X vs base price" hint. 14 tests (7 on the pure `computeStepperState` helper, 7 source-grep on the JSX shell).
- `(artist)/artist/store/[productId]/store-product-client.tsx` — mounts the stepper above the booking CTA for per-song products and threads `songQty` + `unitPriceCents` into the server action.

### Server checkout
- `server/trpc/routers/artist.ts → store.checkout` — accepts `songQty` + `unitPriceCents`, **re-validates** the unit price against `product.volumeTiers` server-side (so a tampered payload can't lock in an unauthorised rate), computes the locked-in total, and passes through to `initiatePaidPlanCheckout`.
- `server/payments/checkout-initiator.ts` — denormalises `songQty` + `unitPriceCents` onto the project insert.

### Producer dashboard
- `(producer)/dashboard/clients-projects/[id]/page.tsx` — when `data.project.songQty > 1`, appends `× N songs` to the project hero title. 7 tests on the migration + write path + render.

### Database
- Migration `0015_per_song_booking_columns.sql` — adds nullable `song_qty` + `unit_price_cents` to `bookings`
- Migration `0016_projects_song_qty.sql` — adds nullable `song_qty` + `unit_price_cents` to `projects`
- `schema.ts` — both tables updated to match
- `apply-migrations.mjs` — patched to accept `DATABASE_URL`, `DATABASE_URL_NEON`, `POSTGRES_URL_NON_POOLING`, or `POSTGRES_URL`

---

## What's still pending

### 1. Apply migrations to Neon (BLOCKER for preview/prod)

The Vercel deploy ships the **code** that expects `bookings.song_qty`, `bookings.unit_price_cents`, `projects.song_qty`, `projects.unit_price_cents` columns. The Neon DB doesn't have them yet. Every query that does `db.select().from(projects)` (no column list) now generates SQL with the new columns and fails with `column "song_qty" does not exist`. That's why `/dashboard` shows "Something buzzed" on the preview.

**To fix — apply migrations:**

The `DATABASE_URL_NEON` env var in Vercel is marked **Sensitive**, which means `vercel env pull` returns the variable name but **not the value** (this is a Vercel security feature, not a bug). The string has to be passed in directly.

Two equally-good ways:

**(a) Inline paste from Neon console:**
```bash
# 1. Neon dashboard → skitza-v3 project → Dashboard → Connection string → copy unpooled
# 2. paste between the quotes:
cd "/Users/giliasraf/skitza-per-song-pricing/packages/db" && DATABASE_URL="<paste-here>" node apply-migrations.mjs
```

**(b) Inline paste from Vercel UI:**
```bash
# 1. Vercel dashboard → Settings → Environment Variables → DATABASE_URL_NEON → reveal (eye icon) → copy
# 2. same command as above
```

You'll see this near the end of the output (the earlier 0000–0014 files have already been applied to the DB so they'll skip / no-op):

```
--- 0015_per_song_booking_columns.sql ---
  ✓ ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "song_qty" integer
  ✓ ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "unit_price_cents" integer
--- 0016_projects_song_qty.sql ---
  ✓ ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "song_qty" integer
  ✓ ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "unit_price_cents" integer
```

**Verify:**
```bash
DATABASE_URL="<paste-again>" node -e "const {neon}=require('@neondatabase/serverless');const sql=neon(process.env.DATABASE_URL);sql\`SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('bookings','projects') AND column_name IN ('song_qty','unit_price_cents') ORDER BY table_name, column_name\`.then(r=>console.log(JSON.stringify(r,null,2)))"
```

Expect 4 rows. If you see `[]`, the URL pointed at the wrong DB (probably the older `skitza` Neon project, not `skitza-v3`).

The `skitza-v3` Neon project is the right one — confirmed by CLAUDE.md (*"fresh skitza-v3 project"*) and visible activity on the Neon dashboard.

### 2. Smoke test on the preview

[Preview URL](https://skitza-v2-web-git-per-song-pricing-design-gili-asrafs-projects.vercel.app)

After the migration runs, hard-refresh (the Skitza service worker caches — per memory `feedback_skitza_sw_cache_on_deploy.md`, **use incognito** for the cleanest test).

**Producer flow:**
1. Sign in as a producer.
2. `/dashboard/store` → "Add product".
3. Click into the **Pricing** step.
4. Flip the segmented pill to **"Per song with discounts"**.
5. Verify the rate-card pre-fills `1 song @ $200` + auto-seeded `5 or more songs @ $170 (15% off)` row.
6. Edit the discount row — both the qty trigger `[5]` and the price `[$170]` are typeable. Totals update inline.
7. The **"Artists will see"** card at the bottom should render the exact store-card copy live as you type.
8. Save.

**Artist flow:**
9. Sign in as an artist linked to that producer.
10. Visit `/artist/store` — the per-song product appears with **"From $170/song · Discounts for bigger projects"**.
11. Click "View details" — the `– / +` **SongCountStepper** renders above "Continue to checkout".
12. Tap `+` past 5 songs — total updates, **"save $X vs base price"** hint appears.
13. Click "Continue to checkout" — Stripe redirect succeeds (or your mock-Stripe flow in preview).

**Producer dashboard:**
14. Switch back to producer.
15. Visit the project from step 13. Verify the hero reads **"Mixing × N songs"** with the correct total.

### 3. Apply migrations to production (after PR merges)

Same exact command as step 1 — `apply-migrations.mjs` is idempotent so re-running on the same DB is a no-op. Per memory `feedback_migrations_not_auto_applied.md`, Vercel deploys code but not SQL.

---

## Architecture decisions worth remembering

**Single math source.** `apps/web/src/lib/pricing.ts` is imported by the producer wizard preview, the producer save path, the artist store card, the artist stepper, AND the server-side checkout re-validation. Five independent code paths, one helper. Zero drift risk.

**Server-side re-validation.** The artist's `unitPriceCents` is re-computed server-side via `unitPriceFor(songQty, product.volumeTiers)` before the checkout proceeds. A tampered client payload can't lock in a price the producer didn't authorise. The mutation returns `BAD_REQUEST: "Pricing changed — refresh the page and try again."` if the rates don't match.

**Pure-helper TDD pattern.** This repo can't render React in tests (`vitest` runs in `node` env, no jsdom, no RTL). The pattern used throughout: extract the *pure logic* (e.g. `computeStepperState`, `buildPackagePayload`, `seedPerSongTiers`) as a named export, unit-test it, then source-grep the `.tsx` for the JSX invariants that wrap it. 40+ new tests for this feature, all green, no flake.

**Why per-song products write to `projects` not `bookings`.** The artist store-checkout flow creates a `project` row in `lead` stage (via the shared `initiatePaidPlanCheckout` helper). No booking row is involved — bookings are for *scheduled sessions*, projects are for *engagements*. Per-song mixing is an engagement without a session, so it lives in `projects`. The denormalised `song_qty` + `unit_price_cents` on `projects` (migration 0016) let the producer dashboard render the qty without re-running tier math. Migration 0015 adds the same columns to `bookings` for when a per-song product *also* needs a session booking (Book tab flow, not yet wired).

**Why `priceCents` mirrors the base tier on per-song products.** Legacy code paths (card lists, filters, search, plan-picker totals) still read `product.priceCents`. For per-song products we mirror `volumeTiers[0].pricePerUnitCents` into `priceCents` so those paths see a sensible number. The wizard's `updateBaseTier()` keeps `draft.price ↔ volumeTiers[0]` in sync while editing.

**Segmented pill vs. radio cards.** The original design (and my first cut) used two radio cards for the flat/per-song toggle. Switched to a segmented pill — radio cards imply "commitment ceremony" for a multi-option choice with rich descriptions, while a binary mode-switch wants the lightweight Linear / Figma / Apple Settings pattern. Aesthetic consistency with the rest of the wizard (which still uses radio cards for the "How artists pay" plan picker) is *intentional inconsistency*: different visual weight for different semantic weight.

---

## Open questions for Raz (or follow-up PR)

1. **Per-song products and the Book tab.** Right now per-song products only appear in `/artist/store`. The `/artist/book` flow (book sessions) doesn't know about them. If a producer wants to sell "5-song mixing" as a sessioned engagement, the booking-side stepper needs to be wired. The `bookings` table is already migrated (0015) for this.

2. **The "Sensitive" Vercel flag on `DATABASE_URL_NEON`.** Makes `vercel env pull` useless for migrations. Three options for follow-up:
   - Keep it Sensitive, document the inline-paste workflow (current state)
   - Unmark Sensitive, accept that `vercel env pull` writes the full URL to `.env.local`
   - Add a separate Vercel env var `DATABASE_URL_MIGRATIONS` (unmarked) pointing at the unpooled URL, used only by the apply script

3. **Pre-existing artist-store test 15** was narrowed from "rejects non-flat pricing" to "rejects hourly + bundle". If the hourly or bundle flow ships later, the test should narrow again. Marker comment in the test file mentions this.

---

## Working with this branch

**Worktree convention:** All work for this PR happens in `/Users/giliasraf/skitza-per-song-pricing`, which is a `git worktree` of the same repo pinned to `per-song-pricing-design`. The main repo at `/Users/giliasraf/Skitza 16.4` can be on any other branch without conflict. The `.git` directory is shared, so commits show up in both. **When the PR merges + this branch is deleted, clean up the worktree:**

```bash
git worktree remove /Users/giliasraf/skitza-per-song-pricing
```

**Why the worktree exists:** A parallel Claude session kept `git checkout`ing me back to a different branch mid-task earlier in this session. The worktree pins one branch per directory, eliminating the contention.

---

## Quick links

- **PR:** [#134](https://github.com/Skitza-G-R/2/pull/134)
- **Preview:** https://skitza-v2-web-git-per-song-pricing-design-gili-asrafs-projects.vercel.app
- **Design doc:** [`docs/plans/active/2026-05-16-per-song-pricing-design.md`](2026-05-16-per-song-pricing-design.md)
- **Implementation plan:** [`docs/plans/active/2026-05-16-per-song-pricing.md`](2026-05-16-per-song-pricing.md)
- **Latest commit:** `2b96706 chore(db): apply-migrations.mjs accepts DATABASE_URL_NEON + POSTGRES_URL`

## Commit list (oldest → newest on top of `v3-clean`)

```
1b77c03 docs(per-song-pricing): design brief
abcc63a docs(per-song-pricing): implementation plan
5585d7c feat(pricing): add unitPriceFor helper with tests
5e7dce6 feat(pricing): add totalFor and fromPrice helpers
62fd696 feat(pricing): add validateTiers
662e8dd feat(db): add songQty and unitPriceCents to bookings
94465b3 feat(store): wire pricingModel + volumeTiers through StoreProduct + Draft
b003d5a feat(store): add per-song pricing toggle + panel to wizard
d5efff3 feat(store): redesign per-song panel — segmented pill + rate-card
b9d1245 feat(actions): persist pricingModel + volumeTiers on package create/update
37bfc6f feat(artist): per-song products land on store + render From $X/song
9c41c14 feat(artist): SongCountStepper component for per-song products
2b5bece feat(artist): wire SongCountStepper into product page + per-song checkout
f9d640c feat(dashboard): per-song projects show × N songs in producer hero
2b96706 chore(db): apply-migrations.mjs accepts DATABASE_URL_NEON + POSTGRES_URL
```
