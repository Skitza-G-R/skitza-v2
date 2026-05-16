# Per-Song Pricing for Storefront Products — Design Brief

**Date:** 2026-05-16
**Author:** Gili (founder) + Claude
**Branch:** `per-song-pricing-design` (off `origin/v3-clean`)
**Status:** Approved by Gili 2026-05-16. Ready to hand off to writing-plans.

> **For the next session:** this document is the source of truth. Every decision below was confirmed in the brainstorm of 2026-05-16. Do not deviate without re-approval from Gili.

---

## TL;DR

Add a **per-song pricing toggle** to the producer's "Add product" wizard so a single product (e.g. "Mixing") can be sold for any number of songs, with optional quantity discounts. Replaces the need to create separate "Single / EP / Album" cards. Reuses existing dormant schema columns (`pricingModel`, `volumeTiers`) — **no migration**. Tiny modal change (one new section inside the Pricing step). Small artist-side change (a song-count picker before booking, with a live price + savings reveal).

---

## 1. Why we're building this

The producer storefront today supports **flat-price products only**. There is no first-class way to sell "an album", "an EP", or any other multi-song offer without creating a separate card per size — which clutters the store and forces the producer to copy/paste includes, contracts, and logistics across 3+ rows.

Real producers price multi-song work in one of two shapes:
1. **Fixed bundles** ("EP = $750, Album = $1,400")
2. **Per song with quantity discounts** ("$200/song, but $150/song after 5 songs")

This design ships shape #2 because it covers shape #1 *and* every off-size between (the "4 songs" case). One toggle, all multi-song offers.

---

## 2. Decisions log (from the 2026-05-16 brainstorm)

| Q | Decision | Notes |
|---|---|---|
| **1. Interpretation of "sell multiple products in 1"** | **Quantity bundle (same service × N songs)** | Not service-combo (production+mix+master in one card). |
| **2. Pricing shape** | **One product, artist picks song count, tiered per-song price** | The "calculator" shape. Was initially "fixed sizes inside a product" but pivoted to per-song after the "4 songs" edge case showed the gap. |
| **3. Data model** | **Reuse existing `products.pricingModel` + `products.volumeTiers` columns** | No new column, no migration. Both columns exist in `packages/db/src/schema.ts:162` and are unused by the wizard today. |
| **4. Default tiers** | **Pre-fill 1 sensible discount on toggle-on** | "5+ songs → 15% off the base price." Producer can edit or delete. Reduces friction. |
| **5. Where in the wizard** | **Inside the existing Pricing step** | No new step. Toggle at the top of the step switches the panel between "Flat" and "Per song." |
| **6. Live preview in the modal** | **Yes — always visible while editing** | Producer sees what 1 / 3 / 5 / 10 songs cost as they type. Removes the mental-math burden. |
| **7. Artist UX** | **Song-count picker before booking, with live total and "you saved $X" message** | Picker is `–`/`+` stepper (default 1). Discount-savings line only renders when a tier is active. |
| **8. Card preview on the store** | **Show "From $X/song · Discounts for more songs"** | The cheapest tier wins the "from" number. Discount sentence only appears if a tier exists. |
| **9. Booking writes the chosen count** | **Save `qty` + `unitPriceCents` on the booking** | Producer dashboard then renders "Mixing × 5 songs — $750". |

### What was explicitly ruled out

- ❌ Per-size turnaround. The product has one turnaround for all song counts.
- ❌ Per-size revisions. The product has one revisions number for all song counts.
- ❌ Service-combo products (production+mix+master in one). User's earlier choice — quantity bundle, not service combo.
- ❌ "Ask the producer for a custom quote" link. Per-song pricing covers every count, so no link is needed.
- ❌ Fixed-bundle UI ("Single / EP / Album cards"). Pivoted away after the "4 songs" gap.

---

## 3. Data model

**No schema change.** Both columns already exist (`packages/db/src/schema.ts`):

| column | type | usage in v1 |
|---|---|---|
| `products.pricingModel` | `text` default `"flat"` | Set to `"per_song"` when the producer flips the toggle. Stays `"flat"` for all existing products. |
| `products.volumeTiers` | `jsonb` nullable | `[{ minQty: 1, pricePerUnitCents: 20000 }, { minQty: 5, pricePerUnitCents: 15000 }]`. Ascending on `minQty`. The first tier (`minQty: 1`) is the base price. |
| `products.priceCents` | `integer` | Still required at the DB level. For `per_song` products we mirror the **base tier's** `pricePerUnitCents` here so legacy flat-price code paths (card lists, filters, search) keep working with sane numbers. |

### Booking row

The booking already has `priceCents`. We add two columns to capture what the artist actually picked:

| column | type | purpose |
|---|---|---|
| `bookings.songQty` | `integer` nullable | How many songs the artist booked. Null for non-per-song bookings. |
| `bookings.unitPriceCents` | `integer` nullable | The per-song rate the artist locked in at booking time (after discount). Null for flat-price bookings. |

`bookings.priceCents` stays as the authoritative total. `songQty × unitPriceCents = priceCents` for per-song bookings — denormalised on purpose so we can re-render "5 × $150 = $750" in the producer dashboard without re-running tier math.

**This is the only migration.** Single column-add on `bookings`. Authorised on this branch (per schema-authorized-clients-projects memory, this rule already exists for redesign branches; Raz reviews the PR).

---

## 4. Producer modal — the wizard change

### Where it lives

`apps/web/src/app/(producer)/dashboard/store/editor-steps/pricing-step.tsx` (302 lines today).

### What changes

Top of the Pricing step gets a new toggle:

```
How do you want to charge?
   ◉ One flat price
   ◯ Per song (with discounts for more songs)
```

**If "Flat":** the step looks exactly like today. No regression for the 4 existing presets.

**If "Per song":** the price field reshapes to:

```
Base price per song
   $ [ 200 ]

Discounts (optional)
   When the artist has [ 5 ] or more songs, drop to $ [ 150 ] per song    [x]
   [ + Add another discount ]

Live preview
   1 song   → $200
   3 songs  → $600
   5 songs  → $750
   10 songs → $1,500
```

### Rules

- Toggle defaults to "Flat" for new products.
- Switching toggles preserves the base number where possible (flat $200 → per-song base $200).
- "Add another discount" appends a row. Rows are validated:
  - `minQty` strictly ascending (we sort + reject duplicates on save).
  - `pricePerUnitCents` strictly descending (you can't get more expensive with more songs; we surface a warning, not a hard block).
- Live preview computes 4 fixed sample counts (1 / 3 / 5 / 10) using the same `priceFor(qty, tiers)` helper the artist side uses. Single source of truth for the math.

### Pre-fill on toggle-on

When the producer flips the toggle from Flat → Per song the first time:
- Base tier (`minQty: 1`) is seeded with the existing flat price.
- One discount tier is auto-added: `minQty: 5, pricePerUnitCents: round(base * 0.85)`.
- Producer can keep, edit, or delete it.

### Step subtitle

The existing copy "Price, how many sessions, and how they pay." stays unchanged. The toggle adds context inline; no new step title.

---

## 5. Artist side

### Store card

`apps/web/src/components/artist/store/product-card.tsx`

Today:
```
Mixing
$200 · 1 session
```

After (when `pricingModel === "per_song"`):
```
Mixing
From $150/song · Discounts for more songs
```

The "from" number is the **cheapest** `pricePerUnitCents` across all tiers. The "Discounts for more songs" suffix only renders when ≥2 tiers exist.

### Click → book flow

Today: card click opens the booking modal directly.

After (for per-song products): card click opens a tiny pre-booking step:

```
How many songs do you have?

       [ – ]   5 songs   [ + ]
       ─────────────────────────
       Total: $750
       (5 × $150 — you saved $250 vs. single-song rate)

       [ Continue to book ]
```

- `–` / `+` stepper, min 1, no upper cap.
- Live total recomputes on every step.
- The "you saved" sentence only renders when the active tier is not the base tier (`minQty > 1`). Savings = `(basePrice − activePrice) × qty`.
- "Continue to book" carries `songQty` and `unitPriceCents` into the booking modal so the booking creates with the locked-in price.

For flat-price products this pre-booking step does not appear. Behaviour unchanged.

---

## 6. Shared helper — single math source

New file: `packages/db/src/lib/per-song-pricing.ts` (or a co-located module in `apps/web/src/lib/pricing.ts` — TBD by implementor based on where the artist + producer code both reach).

```ts
export interface VolumeTier {
  minQty: number;
  pricePerUnitCents: number;
}

export function unitPriceFor(qty: number, tiers: VolumeTier[]): number {
  // Returns the cents-per-song for the active tier given a song count.
  // Tiers are expected sorted ascending on minQty.
  // Falls through to the base tier if qty < first.minQty (shouldn't happen).
}

export function totalFor(qty: number, tiers: VolumeTier[]): number {
  return qty * unitPriceFor(qty, tiers);
}

export function fromPrice(tiers: VolumeTier[]): number {
  // Cheapest pricePerUnitCents — used for "From $X/song" card copy.
}
```

The wizard's live preview, the artist's pre-booking calc, and the booking server action all call these. No duplicated math anywhere.

---

## 7. Test plan

**Unit (Vitest):**
- `unitPriceFor(qty, tiers)` — fall-through correctness across 1 / 2 / 3 / 4 / 5 / 9 / 10 / 100 songs against a 3-tier ladder.
- `totalFor` and `fromPrice` agree with `unitPriceFor`.
- Tier validation: rejects non-ascending `minQty`, rejects non-descending `pricePerUnitCents` (warns but allows? — implementor decides; spec is "warn").
- Saving a per-song product through the existing `createPackage` action persists `pricingModel`, `volumeTiers`, and a synthetic `priceCents` (= base tier cents).

**Integration:**
- New per-song product appears in `/dashboard/store` with "From $X/song · Discounts" copy.
- Editing an existing flat product, flipping the toggle, and saving converts it cleanly (flat $200 → base $200, no data loss).
- Toggling from Per song back to Flat clears `volumeTiers` to null and reverts `pricingModel` to `"flat"`.

**Artist-facing:**
- Card renders "From" price correctly when tiers exist; falls back to flat when not.
- Pre-booking stepper math equals server math when the booking is created (no race-condition pricing drift).
- Booking row stores `songQty` and `unitPriceCents`; producer dashboard renders "× N songs" line item.

**Visual:**
- Pricing step toggle on / off animates the panel swap cleanly (re-use existing `sk-press` / animation tokens).
- Card "From $X/song" copy fits all 4 tile themes (Mix / Master / Production / Consult).

---

## 8. Out of scope for v1 (not "never" — just not this round)

| Idea | Why not now |
|---|---|
| Per-song-count turnaround | One turnaround field covers most real offers. Producer can write "5–7 days per song" in the text. |
| Per-song-count revisions | Same. "2 revisions per song" or "2 for the project" both work with one number. |
| Service-combo products (production + mix + master in one) | Ruled out by user's choice at Q1. Future task if requested. |
| "Ask the producer" custom-quote link | Per-song pricing covers every count. No dead-end cases left. |
| Per-song bundles UI (Single / EP / Album cards) | Pivoted away after the "4 songs" gap. Per-song supersedes. |
| Service add-ons priced separately (e.g. +$50 per song for stems) | Stretches the math. Add later as `addOns` on the product. |

---

## 9. Code touchpoints summary

| Layer | File | Change |
|---|---|---|
| Schema | `packages/db/src/schema.ts` | Add `bookings.songQty` + `bookings.unitPriceCents` columns. (Migration 0019.) |
| Producer wizard | `apps/web/src/app/(producer)/dashboard/store/editor-steps/pricing-step.tsx` | Add toggle + per-song panel + live preview. |
| Producer wizard | `apps/web/src/app/(producer)/dashboard/store/product-editor.tsx` | Extend `Draft` interface with `pricingModel` + `volumeTiers`. |
| Server actions | `apps/web/src/app/(producer)/dashboard/booking/actions.ts` | `createPackage` / `updatePackage` accept + persist `pricingModel` + `volumeTiers`. |
| Math helper | new file in `apps/web/src/lib/pricing.ts` (or `@skitza/db`) | Pure functions for `unitPriceFor` / `totalFor` / `fromPrice`. |
| Artist card | `apps/web/src/components/artist/store/product-card.tsx` | Render "From $X/song" + discounts hint. |
| Artist booking | (booking modal / page wherever store card click lands) | Inject pre-booking song-count stepper for per-song products. |
| Booking action | wherever bookings are created today | Accept `songQty` + `unitPriceCents`; compute `priceCents = songQty × unitPriceCents`. |
| Tests | `apps/web/src/app/(producer)/dashboard/store/__tests__/` + new pricing-math tests | Vitest specs from §7. |

---

## 10. What ships in this branch

One PR off `origin/v3-clean`:

1. Migration 0019 — `bookings.songQty` + `bookings.unitPriceCents`.
2. Math helper + unit tests.
3. Producer wizard toggle + per-song panel + live preview.
4. Server actions accept the new fields.
5. Artist card "From" copy + pre-booking stepper.
6. Booking write path captures `songQty` + `unitPriceCents`.
7. Producer dashboard surface that displays "× N songs" on booking rows.

No follow-up PR planned at design time. If §9 grows during build, split is implementor's call.
