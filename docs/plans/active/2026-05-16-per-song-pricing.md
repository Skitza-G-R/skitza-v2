# Per-Song Pricing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a per-song pricing toggle to the storefront "Add product" wizard so one product can be sold for any number of songs with optional quantity discounts. Replaces the need for separate Single/EP/Album cards.

**Architecture:** Reuse dormant `products.pricingModel` + `products.volumeTiers` columns (no products migration). One small migration on `bookings` to capture `songQty` + `unitPriceCents`. Pure-function math helper drives wizard live preview, artist stepper, and server-side booking math from a single source. New UI lives inside the existing 5-step wizard (no new step) and inside the existing artist product page (one stepper before the booking CTA).

**Tech Stack:** Next.js 15 App Router · tRPC v11 server actions · Drizzle + Neon · Tailwind v4 + shadcn/ui · Vitest · Testing Library.

**Design source:** `docs/plans/active/2026-05-16-per-song-pricing-design.md`

**Branch:** `per-song-pricing-design` (already off `origin/v3-clean`, design doc already committed).

---

## Pre-flight

Before Task 1, verify environment:

```bash
git branch --show-current   # → per-song-pricing-design
git log --oneline -1         # → 1b77c03 docs(per-song-pricing): design brief …
pnpm install                 # idempotent, ensures lockfile is clean
```

If branch is wrong: `git checkout per-song-pricing-design`.

---

## Phase 1 — Pricing math helper (pure functions, TDD)

### Task 1: Confirm next migration number

**Files:**
- Read: `packages/db/drizzle/meta/_journal.json`
- Read: `packages/db/drizzle/` (list)

**Step 1: Inspect journal + folder**

Run: `ls packages/db/drizzle/ | grep -E '^[0-9]{4}' | sort -u`

Read `packages/db/drizzle/meta/_journal.json` and find the highest `tag` value (memory note: journal stops at 0018 even if some files are missing).

**Step 2: Decide migration number**

Per memory `feedback_migrations_not_auto_applied.md`, the journal is authoritative for what's been *generated*; the SQL files on disk may have gaps. Use the next number AFTER the journal's highest tag. Record this number — referred to below as `<MIG>` (likely `0019`).

**Step 3: No commit** — research only.

---

### Task 2: Create pricing math module with failing test for `unitPriceFor`

**Files:**
- Create: `apps/web/src/lib/pricing.ts`
- Create: `apps/web/src/lib/__tests__/pricing.test.ts`

**Step 1: Write the failing test**

```ts
// apps/web/src/lib/__tests__/pricing.test.ts
import { describe, expect, it } from "vitest";

import { unitPriceFor } from "../pricing";

const TIERS = [
  { minQty: 1, pricePerUnitCents: 20000 },
  { minQty: 3, pricePerUnitCents: 17000 },
  { minQty: 5, pricePerUnitCents: 15000 },
  { minQty: 10, pricePerUnitCents: 12000 },
];

describe("unitPriceFor", () => {
  it("returns base tier for 1 song", () => {
    expect(unitPriceFor(1, TIERS)).toBe(20000);
  });
  it("returns base tier for 2 songs (below first discount)", () => {
    expect(unitPriceFor(2, TIERS)).toBe(20000);
  });
  it("returns 3-tier price for exactly 3 songs", () => {
    expect(unitPriceFor(3, TIERS)).toBe(17000);
  });
  it("returns 3-tier price for 4 songs (between tiers)", () => {
    expect(unitPriceFor(4, TIERS)).toBe(17000);
  });
  it("returns 5-tier price for 5 songs", () => {
    expect(unitPriceFor(5, TIERS)).toBe(15000);
  });
  it("returns 10-tier price for 100 songs", () => {
    expect(unitPriceFor(100, TIERS)).toBe(12000);
  });
  it("falls back to base when qty is 0 (defensive)", () => {
    expect(unitPriceFor(0, TIERS)).toBe(20000);
  });
  it("returns 0 when tiers array is empty (defensive)", () => {
    expect(unitPriceFor(5, [])).toBe(0);
  });
});
```

**Step 2: Create the module with the type but no implementation**

```ts
// apps/web/src/lib/pricing.ts
export interface VolumeTier {
  minQty: number;
  pricePerUnitCents: number;
}

export function unitPriceFor(qty: number, tiers: VolumeTier[]): number {
  throw new Error("not implemented");
}
```

**Step 3: Run test, expect fail**

Run: `pnpm -F web vitest run apps/web/src/lib/__tests__/pricing.test.ts`
Expected: 8 failing tests with "not implemented".

**Step 4: Implement**

```ts
export function unitPriceFor(qty: number, tiers: VolumeTier[]): number {
  if (tiers.length === 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  let active = sorted[0];
  for (const tier of sorted) {
    if (qty >= tier.minQty) active = tier;
  }
  return active.pricePerUnitCents;
}
```

**Step 5: Run test, expect pass**

Run: `pnpm -F web vitest run apps/web/src/lib/__tests__/pricing.test.ts`
Expected: 8 passing.

**Step 6: Commit**

```bash
git add apps/web/src/lib/pricing.ts apps/web/src/lib/__tests__/pricing.test.ts
git commit -m "feat(pricing): add unitPriceFor helper with tests"
```

---

### Task 3: Add `totalFor` and `fromPrice` helpers (TDD)

**Files:**
- Modify: `apps/web/src/lib/pricing.ts`
- Modify: `apps/web/src/lib/__tests__/pricing.test.ts`

**Step 1: Append failing tests**

```ts
describe("totalFor", () => {
  it("multiplies qty by active tier", () => {
    expect(totalFor(5, TIERS)).toBe(75000); // 5 × 15000
  });
  it("returns 0 for qty 0", () => {
    expect(totalFor(0, TIERS)).toBe(0);
  });
});

describe("fromPrice", () => {
  it("returns the cheapest pricePerUnitCents", () => {
    expect(fromPrice(TIERS)).toBe(12000);
  });
  it("returns 0 when tiers empty", () => {
    expect(fromPrice([])).toBe(0);
  });
  it("works with a single base tier", () => {
    expect(fromPrice([{ minQty: 1, pricePerUnitCents: 20000 }])).toBe(20000);
  });
});
```

Add to imports at top: `import { totalFor, unitPriceFor, fromPrice } from "../pricing";`

**Step 2: Run, expect fail (totalFor/fromPrice undefined)**

Run: `pnpm -F web vitest run apps/web/src/lib/__tests__/pricing.test.ts`

**Step 3: Implement**

```ts
export function totalFor(qty: number, tiers: VolumeTier[]): number {
  return qty * unitPriceFor(qty, tiers);
}

export function fromPrice(tiers: VolumeTier[]): number {
  if (tiers.length === 0) return 0;
  return Math.min(...tiers.map((t) => t.pricePerUnitCents));
}
```

**Step 4: Run, expect pass.** All ~13 tests green.

**Step 5: Commit**

```bash
git add apps/web/src/lib/pricing.ts apps/web/src/lib/__tests__/pricing.test.ts
git commit -m "feat(pricing): add totalFor and fromPrice helpers"
```

---

### Task 4: Add `validateTiers` helper for wizard-side validation

**Files:**
- Modify: `apps/web/src/lib/pricing.ts`
- Modify: `apps/web/src/lib/__tests__/pricing.test.ts`

**Step 1: Append failing tests**

```ts
describe("validateTiers", () => {
  it("returns no errors for a valid ascending ladder", () => {
    expect(validateTiers(TIERS)).toEqual({ errors: [], warnings: [] });
  });
  it("errors on duplicate minQty", () => {
    const bad = [
      { minQty: 1, pricePerUnitCents: 20000 },
      { minQty: 1, pricePerUnitCents: 17000 },
    ];
    expect(validateTiers(bad).errors).toContain("DUPLICATE_MIN_QTY");
  });
  it("errors on minQty < 1", () => {
    expect(validateTiers([{ minQty: 0, pricePerUnitCents: 100 }]).errors).toContain(
      "MIN_QTY_TOO_LOW",
    );
  });
  it("warns when price doesn't decrease with quantity", () => {
    const flat = [
      { minQty: 1, pricePerUnitCents: 20000 },
      { minQty: 5, pricePerUnitCents: 25000 },
    ];
    expect(validateTiers(flat).warnings).toContain("PRICE_NOT_DECREASING");
  });
});
```

**Step 2: Implement**

```ts
export interface TierValidation {
  errors: string[];
  warnings: string[];
}

export function validateTiers(tiers: VolumeTier[]): TierValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<number>();
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  for (const t of sorted) {
    if (t.minQty < 1) errors.push("MIN_QTY_TOO_LOW");
    if (seen.has(t.minQty)) errors.push("DUPLICATE_MIN_QTY");
    seen.add(t.minQty);
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].pricePerUnitCents >= sorted[i - 1].pricePerUnitCents) {
      warnings.push("PRICE_NOT_DECREASING");
      break;
    }
  }
  return { errors, warnings };
}
```

**Step 3: Run, pass, commit.**

```bash
git add apps/web/src/lib/pricing.ts apps/web/src/lib/__tests__/pricing.test.ts
git commit -m "feat(pricing): add validateTiers"
```

---

## Phase 2 — Schema migration for booking song-quantity

### Task 5: Add `songQty` + `unitPriceCents` columns to `bookings`

**Files:**
- Modify: `packages/db/src/schema.ts:283` (bookings table)

**Step 1: Read current bookings table**

Use Read tool on `packages/db/src/schema.ts:283-360` to see the existing column list.

**Step 2: Add the two columns**

Append (before `createdAt`) inside the `bookings` `pgTable`:

```ts
// Per-song bookings only — null for flat-price bookings.
// songQty is how many songs the artist booked. unitPriceCents is the
// per-song rate they locked in at booking time (already after tier
// discount). priceCents stays the authoritative total.
songQty: integer("song_qty"),
unitPriceCents: integer("unit_price_cents"),
```

**Step 3: Generate migration**

Run: `pnpm -F db db:generate`
Expected: a new SQL file in `packages/db/drizzle/<MIG>_<name>.sql`.

**Step 4: Inspect generated SQL**

Open the new file. Verify it contains:
```sql
ALTER TABLE "bookings" ADD COLUMN "song_qty" integer;
ALTER TABLE "bookings" ADD COLUMN "unit_price_cents" integer;
```

If drizzle adds anything else unexpected, stop and ask.

**Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/<MIG>_*.sql packages/db/drizzle/meta/
git commit -m "feat(db): add songQty and unitPriceCents to bookings"
```

---

### Task 6: Apply migration locally

**Step 1: Pull DATABASE_URL**

```bash
vercel env pull .env.local
```
Or read it from the Neon console (per memory `feedback_migrations_not_auto_applied.md`).

**Step 2: Apply migration**

Run: `node packages/db/apply-migrations.mjs`
Expected: prints "applied <MIG>_<name>" and exits 0.

**Step 3: Verify columns exist**

Run via Neon SQL editor or `psql`:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'bookings' AND column_name IN ('song_qty', 'unit_price_cents');
```
Expected: 2 rows.

**Step 4: No commit** — production apply happens later via Gili after PR merge.

---

## Phase 3 — Producer wizard: pricing-model toggle + per-song panel

### Task 7: Extend `Draft` interface in product-editor.tsx

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/store/product-editor.tsx`

**Step 1: Add fields to the `Draft` interface (around line 60)**

```ts
interface Draft {
  // … existing fields …
  pricingModel: "flat" | "per_song";
  volumeTiers: VolumeTier[];        // empty array when flat
}
```

Add import at top:
```ts
import type { VolumeTier } from "~/lib/pricing";
```

**Step 2: Initialize defaults in the `initialDraft` function**

Existing products: hydrate from `product.pricingModel` (string cast) and `product.volumeTiers ?? []`.
New products (no product passed): default to `{ pricingModel: "flat", volumeTiers: [] }`.

**Step 3: Pass new fields into `PricingStep` props**

Find where `<PricingStep>` is rendered. Pass `pricingModel`, `volumeTiers`, and an `onPricingChange` handler that does a shallow merge into draft.

**Step 4: Add to the payload passed to `createPackage` / `updatePackage`**

Locate the save handler. Add `pricingModel` and `volumeTiers` to the action input. (Server-side acceptance is Task 11. For now TS will complain — that's expected and proves wiring.)

**Step 5: No commit yet** — combined with Task 8.

---

### Task 8: Write failing tests for the pricing-step toggle

**Files:**
- Create: `apps/web/src/app/(producer)/dashboard/store/__tests__/pricing-step.test.tsx`

**Step 1: Write the tests**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PricingStep } from "../editor-steps/pricing-step";

const baseProps = {
  // existing required props for the step — copy from product-editor.tsx
  // include: price, currency, sessions, paymentPlan, etc., plus the new:
  pricingModel: "flat" as const,
  volumeTiers: [],
  onPricingChange: () => {},
  // … rest of the props
};

describe("PricingStep — per-song toggle", () => {
  it("renders the flat-price panel by default", () => {
    render(<PricingStep {...baseProps} />);
    expect(screen.getByLabelText(/one flat price/i)).toBeChecked();
    expect(screen.queryByLabelText(/base price per song/i)).not.toBeInTheDocument();
  });

  it("renders the per-song panel when toggled", async () => {
    const user = userEvent.setup();
    render(<PricingStep {...baseProps} />);
    await user.click(screen.getByLabelText(/per song/i));
    expect(screen.getByLabelText(/base price per song/i)).toBeInTheDocument();
  });

  it("pre-fills one discount tier on first toggle-on", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PricingStep {...baseProps} price={200} onPricingChange={onChange} />);
    await user.click(screen.getByLabelText(/per song/i));
    const lastCall = onChange.mock.calls.at(-1)?.[0];
    expect(lastCall.volumeTiers).toHaveLength(2);
    expect(lastCall.volumeTiers[0]).toEqual({ minQty: 1, pricePerUnitCents: 20000 });
    expect(lastCall.volumeTiers[1].minQty).toBe(5);
    expect(lastCall.volumeTiers[1].pricePerUnitCents).toBe(17000); // 15% off rounded
  });

  it("renders the live preview rows", async () => {
    const user = userEvent.setup();
    render(<PricingStep {...baseProps} />);
    await user.click(screen.getByLabelText(/per song/i));
    expect(screen.getByText(/1 song/i)).toBeInTheDocument();
    expect(screen.getByText(/3 songs/i)).toBeInTheDocument();
    expect(screen.getByText(/5 songs/i)).toBeInTheDocument();
    expect(screen.getByText(/10 songs/i)).toBeInTheDocument();
  });
});
```

**Step 2: Run, expect fail.**

Run: `pnpm -F web vitest run apps/web/src/app/\(producer\)/dashboard/store/__tests__/pricing-step.test.tsx`

Expected: all 4 fail because the toggle / panel / preview don't exist yet.

**Step 3: No commit** — paired with Task 9.

---

### Task 9: Implement the toggle + per-song panel in pricing-step.tsx

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/store/editor-steps/pricing-step.tsx`

**Step 1: Add props**

Extend `PricingStepProps` with `pricingModel`, `volumeTiers`, `onPricingChange`.

**Step 2: Render toggle at top of step**

Two radio buttons: "One flat price" / "Per song (with discounts for more songs)". Use Tailwind classes consistent with the rest of the wizard (study other steps for matching token names).

**Step 3: Conditional render**

When `pricingModel === "flat"`: existing flat-price UI (unchanged).
When `pricingModel === "per_song"`: render the new panel with:
- Base price input (writes to `volumeTiers[0].pricePerUnitCents`).
- Tier rows (map `volumeTiers.slice(1)`) with minQty + price + remove button.
- "+ Add another discount" button (appends a tier with `minQty: last.minQty + 5, pricePerUnitCents: round(last.price * 0.85)`).
- Live preview: 4 fixed rows (1 / 3 / 5 / 10) computed via `totalFor()` from `~/lib/pricing`.

**Step 4: Implement pre-fill on first toggle-on**

When user clicks "per song" and `volumeTiers.length === 0`:
- Seed `[{ minQty: 1, pricePerUnitCents: priceCentsFromFlat }, { minQty: 5, pricePerUnitCents: Math.round(priceCentsFromFlat * 0.85) }]`.
- Call `onPricingChange({ pricingModel: "per_song", volumeTiers: seeded })`.

When user toggles back to flat:
- Call `onPricingChange({ pricingModel: "flat", volumeTiers: [] })`.

**Step 5: Run tests**

Run: `pnpm -F web vitest run apps/web/src/app/\(producer\)/dashboard/store/__tests__/pricing-step.test.tsx`
Expected: 4 passing.

**Step 6: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/editor-steps/pricing-step.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/__tests__/pricing-step.test.tsx \
        apps/web/src/app/\(producer\)/dashboard/store/product-editor.tsx
git commit -m "feat(store): add per-song pricing toggle + panel to wizard"
```

---

### Task 10: Live-preview matches helper math (regression test)

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/store/__tests__/pricing-step.test.tsx`

**Step 1: Add a test that asserts displayed preview equals `totalFor()` output**

```tsx
it("live preview matches totalFor() across sample counts", async () => {
  const user = userEvent.setup();
  render(<PricingStep {...baseProps} price={200} />);
  await user.click(screen.getByLabelText(/per song/i));

  // After pre-fill: tier 1 = $200, tier 5 = $170
  // expected: 1 → $200, 3 → $600, 5 → $850, 10 → $1700
  expect(screen.getByText(/\$200(\.|\b)/)).toBeInTheDocument();
  expect(screen.getByText(/\$600/)).toBeInTheDocument();
  expect(screen.getByText(/\$850/)).toBeInTheDocument();
  expect(screen.getByText(/\$1,?700/)).toBeInTheDocument();
});
```

**Step 2: Run, fix display formatting if tests fail.**

**Step 3: Commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/store/__tests__/pricing-step.test.tsx
git commit -m "test(store): regression test for live-preview math"
```

---

## Phase 4 — Server actions accept new fields

### Task 11: Extend `createPackage` and `updatePackage`

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/booking/actions.ts:61` and `:89`

**Step 1: Find both functions; add to input type**

```ts
{
  // … existing fields …
  pricingModel?: "flat" | "per_song";
  volumeTiers?: { minQty: number; pricePerUnitCents: number }[];
}
```

**Step 2: Persist to the products row**

Inside the Drizzle `.insert(products).values({...})` / `.update(...).set({...})` call, add:
```ts
pricingModel: input.pricingModel ?? "flat",
volumeTiers: input.volumeTiers ?? null,
// Mirror base tier into priceCents so flat-price code paths keep working:
priceCents: input.pricingModel === "per_song" && input.volumeTiers?.length
  ? input.volumeTiers[0].pricePerUnitCents
  : input.priceCents,
```

**Step 3: Write a server-action integration test**

Create: `apps/web/src/app/(producer)/dashboard/booking/__tests__/actions-per-song.test.ts`

Mock the DB. Assert that calling `createPackage({ pricingModel: "per_song", volumeTiers: [{minQty:1,pricePerUnitCents:20000},{minQty:5,pricePerUnitCents:15000}], … })` writes `priceCents: 20000`, `pricingModel: "per_song"`, and the tiers as JSON.

**Step 4: Run tests, pass, commit**

```bash
git add apps/web/src/app/\(producer\)/dashboard/booking/actions.ts \
        apps/web/src/app/\(producer\)/dashboard/booking/__tests__/actions-per-song.test.ts
git commit -m "feat(actions): persist pricingModel + volumeTiers on package create/update"
```

---

### Task 12: Round-trip test — create per-song product, read back, render in store

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/store/__tests__/store-screen.test.tsx` (or wherever a list-render integration test lives)

**Step 1: Add a test that asserts a per-song product appears in the store list**

Mock a product fixture with `pricingModel: "per_song"`, tiers, and assert the card renders "From $X/song".

**Step 2: Run, expect fail** (card not yet updated — Phase 5).

**Step 3: No commit** — paired with Task 13.

---

## Phase 5 — Artist store card

### Task 13: Update artist product card to show "From $X/song"

**Files:**
- Modify: `apps/web/src/components/artist/store/product-card.tsx`

**Step 1: Write failing test first**

Create: `apps/web/src/components/artist/store/__tests__/product-card.test.tsx` (if doesn't exist).

```tsx
describe("ProductCard — per-song", () => {
  it("renders 'From $X/song' when pricingModel is per_song", () => {
    render(
      <ProductCard
        product={{
          ...baseProduct,
          pricingModel: "per_song",
          volumeTiers: [
            { minQty: 1, pricePerUnitCents: 20000 },
            { minQty: 5, pricePerUnitCents: 15000 },
          ],
        }}
      />,
    );
    expect(screen.getByText(/from \$150\/song/i)).toBeInTheDocument();
  });

  it("renders 'Discounts for more songs' when ≥2 tiers", () => {
    // same setup as above
    expect(screen.getByText(/discounts for more songs/i)).toBeInTheDocument();
  });

  it("falls back to flat price when pricingModel is flat", () => {
    render(<ProductCard product={baseProduct} />);
    expect(screen.queryByText(/from .* \/song/i)).not.toBeInTheDocument();
  });
});
```

**Step 2: Implement card change**

In the card's price-line render, branch on `pricingModel`:
```tsx
{product.pricingModel === "per_song" && product.volumeTiers?.length ? (
  <>
    <span>From ${fromPrice(product.volumeTiers) / 100}/song</span>
    {product.volumeTiers.length >= 2 && (
      <span className="text-[rgb(var(--fg-muted))]"> · Discounts for more songs</span>
    )}
  </>
) : (
  /* existing flat-price render */
)}
```

**Step 3: Run, pass, commit**

```bash
git add apps/web/src/components/artist/store/product-card.tsx \
        apps/web/src/components/artist/store/__tests__/product-card.test.tsx
git commit -m "feat(artist): show 'From \$X/song' on per-song product cards"
```

---

## Phase 6 — Artist pre-booking song-count stepper

### Task 14: Build the `SongCountStepper` component

**Files:**
- Create: `apps/web/src/app/(artist)/artist/store/[productId]/song-count-stepper.tsx`
- Create: `apps/web/src/app/(artist)/artist/store/[productId]/__tests__/song-count-stepper.test.tsx`

**Step 1: Write tests**

```tsx
describe("SongCountStepper", () => {
  const TIERS = [
    { minQty: 1, pricePerUnitCents: 20000 },
    { minQty: 5, pricePerUnitCents: 15000 },
  ];

  it("starts at qty 1 with total = base × 1", () => {
    render(<SongCountStepper tiers={TIERS} onChange={() => {}} />);
    expect(screen.getByText("1 song")).toBeInTheDocument();
    expect(screen.getByText(/\$200/)).toBeInTheDocument();
  });

  it("increments qty and updates total on +", async () => {
    const user = userEvent.setup();
    render(<SongCountStepper tiers={TIERS} onChange={() => {}} />);
    await user.click(screen.getByLabelText(/increase/i));
    expect(screen.getByText("2 songs")).toBeInTheDocument();
    expect(screen.getByText(/\$400/)).toBeInTheDocument();
  });

  it("does not decrement below 1", async () => {
    const user = userEvent.setup();
    render(<SongCountStepper tiers={TIERS} onChange={() => {}} />);
    await user.click(screen.getByLabelText(/decrease/i));
    expect(screen.getByText("1 song")).toBeInTheDocument();
  });

  it("shows 'you saved' line when a discount tier is active", async () => {
    const user = userEvent.setup();
    render(<SongCountStepper tiers={TIERS} onChange={() => {}} />);
    for (let i = 0; i < 4; i++) await user.click(screen.getByLabelText(/increase/i));
    // qty = 5, active tier = $150, base = $200, saved = (200-150) × 5 = $250
    expect(screen.getByText(/you saved \$250/i)).toBeInTheDocument();
  });

  it("calls onChange with qty and unitPriceCents", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SongCountStepper tiers={TIERS} onChange={onChange} />);
    await user.click(screen.getByLabelText(/increase/i));
    expect(onChange).toHaveBeenLastCalledWith({ qty: 2, unitPriceCents: 20000 });
  });
});
```

**Step 2: Implement**

```tsx
"use client";
import { useState, useEffect } from "react";
import { fromPrice, totalFor, unitPriceFor, type VolumeTier } from "~/lib/pricing";

interface Props {
  tiers: VolumeTier[];
  onChange: (state: { qty: number; unitPriceCents: number }) => void;
}

export function SongCountStepper({ tiers, onChange }: Props) {
  const [qty, setQty] = useState(1);
  const unit = unitPriceFor(qty, tiers);
  const total = totalFor(qty, tiers);
  const basePrice = tiers[0]?.pricePerUnitCents ?? 0;
  const saved = (basePrice - unit) * qty;

  useEffect(() => {
    onChange({ qty, unitPriceCents: unit });
  }, [qty, unit, onChange]);

  return (
    <div className="…">
      <div className="flex items-center gap-3">
        <button aria-label="Decrease songs" onClick={() => setQty((q) => Math.max(1, q - 1))}>
          –
        </button>
        <span>{qty} {qty === 1 ? "song" : "songs"}</span>
        <button aria-label="Increase songs" onClick={() => setQty((q) => q + 1)}>
          +
        </button>
      </div>
      <div>Total: ${(total / 100).toLocaleString()}</div>
      {saved > 0 && (
        <div className="text-[rgb(var(--fg-muted))]">
          ({qty} × ${unit / 100} — you saved ${saved / 100} vs. single-song rate)
        </div>
      )}
    </div>
  );
}
```

**Step 3: Run, pass, commit**

```bash
git add apps/web/src/app/\(artist\)/artist/store/\[productId\]/song-count-stepper.tsx \
        apps/web/src/app/\(artist\)/artist/store/\[productId\]/__tests__/song-count-stepper.test.tsx
git commit -m "feat(artist): SongCountStepper component"
```

---

### Task 15: Wire stepper into store-product-client.tsx

**Files:**
- Modify: `apps/web/src/app/(artist)/artist/store/[productId]/store-product-client.tsx`

**Step 1: Read the file to locate the booking-CTA section**

Use Read tool to find the "book now" / "continue" button and the existing state.

**Step 2: Conditional render**

Above the booking CTA:
```tsx
{product.pricingModel === "per_song" && product.volumeTiers?.length ? (
  <SongCountStepper
    tiers={product.volumeTiers}
    onChange={({ qty, unitPriceCents }) => {
      setSongQty(qty);
      setUnitPriceCents(unitPriceCents);
    }}
  />
) : null}
```

**Step 3: Add local state**

```ts
const [songQty, setSongQty] = useState<number | null>(null);
const [unitPriceCents, setUnitPriceCents] = useState<number | null>(null);
```

For per-song products, default to 1 × base tier (matches the stepper's initial emit).

**Step 4: Pass through to booking action**

When the artist clicks "Continue to book", the booking action call must receive `songQty` and `unitPriceCents` for per-song products.

**Step 5: Commit**

```bash
git add apps/web/src/app/\(artist\)/artist/store/\[productId\]/store-product-client.tsx
git commit -m "feat(artist): wire SongCountStepper into product page"
```

---

## Phase 7 — Booking write path captures qty + locked-in price

### Task 16: Extend booking server action

**Files:**
- Modify: `apps/web/src/app/(artist)/artist/store/[productId]/actions.ts`

**Step 1: Add to input type**

```ts
songQty?: number;
unitPriceCents?: number;
```

**Step 2: Compute and persist**

```ts
const priceCents = input.songQty && input.unitPriceCents
  ? input.songQty * input.unitPriceCents
  : product.priceCents;

await db.insert(bookings).values({
  // … existing fields …
  priceCents,
  songQty: input.songQty ?? null,
  unitPriceCents: input.unitPriceCents ?? null,
});
```

**Step 3: Write integration test**

Create: `apps/web/src/app/(artist)/artist/store/[productId]/__tests__/actions.test.ts`

Mock DB. Assert that booking a per-song product with `{ songQty: 5, unitPriceCents: 15000 }` writes `priceCents: 75000` + the two columns.

**Step 4: Run, pass, commit**

```bash
git add apps/web/src/app/\(artist\)/artist/store/\[productId\]/actions.ts \
        apps/web/src/app/\(artist\)/artist/store/\[productId\]/__tests__/actions.test.ts
git commit -m "feat(artist): persist songQty + unitPriceCents on per-song bookings"
```

---

### Task 17: Producer dashboard renders "× N songs" on booking rows

**Files:**
- Find the booking-row component on producer dashboard. Likely `apps/web/src/app/(producer)/dashboard/clients-projects/*` or `dashboard/page.tsx`.

**Step 1: Grep for current booking-row render**

Run: `grep -rn "booking.priceCents\|booking\.price_cents" apps/web/src/app/\(producer\)/`

**Step 2: For each location, conditionally render "× N songs"**

```tsx
{booking.songQty ? (
  <span>{booking.name} × {booking.songQty} songs — ${booking.priceCents / 100}</span>
) : (
  <span>{booking.name} — ${booking.priceCents / 100}</span>
)}
```

**Step 3: Add a snapshot or rendered-text test for each touched component**

**Step 4: Run, pass, commit**

```bash
git add <touched-files>
git commit -m "feat(dashboard): show '× N songs' on per-song booking rows"
```

---

## Phase 8 — Verify + ship

### Task 18: Full verification pipeline

**Step 1: Run the full gate**

Run: `/skitza-verify` (or manually: `pnpm typecheck && pnpm -F web lint && pnpm test`)

Expected: all green. Per memory `feedback_run_lint_not_just_typecheck.md`, lint failures break Vercel deploy — must pass.

**Step 2: If any failure, fix and re-run before committing.**

**Step 3: No commit** unless fixes were needed.

---

### Task 19: Manual smoke test

**Step 1: Start dev server**

Run: `pnpm -F web dev`

**Step 2: Producer flow**
- Sign in as a producer.
- Open `/dashboard/store`.
- "Add product" → wizard.
- In Pricing step, flip "Per song" toggle.
- Verify: pre-filled base + 1 discount tier appear, live preview shows 1 / 3 / 5 / 10 song totals.
- Save.
- Verify: new product appears in store list with "From $X/song · Discounts for more songs".

**Step 3: Artist flow**
- Sign in as an artist (different account) and visit the producer's `/join/[slug]` to land on the store.
- Click the per-song product.
- Verify: stepper appears, total updates on +/-, "you saved" line appears at qty 5+.
- Click "Continue to book", complete booking.

**Step 4: Verify booking on producer side**
- Switch back to producer.
- Visit dashboard, find the new booking row.
- Verify: shows "× N songs — $total".

**Step 5: No commit** — manual test only.

---

### Task 20: Open PR

**Step 1: Push branch**

```bash
git push -u origin per-song-pricing-design
```

**Step 2: Open PR via gh**

```bash
gh pr create --base v3-clean --title "feat: per-song pricing for storefront products" --body "$(cat <<'EOF'
## Summary
- Adds a per-song pricing toggle to the producer's Add-product wizard
- Single product can sell any number of songs with optional tier discounts
- Reuses dormant `products.pricingModel` + `products.volumeTiers` columns (no products migration)
- One migration on `bookings` to capture `song_qty` + `unit_price_cents`
- Pure-function math helper drives wizard preview, artist stepper, and server-side booking math from a single source
- Artist sees "From $X/song" on store card + a +/- song-count stepper with live total and "you saved $Y" reveal

## Design doc
[2026-05-16-per-song-pricing-design.md](docs/plans/active/2026-05-16-per-song-pricing-design.md)

## Test plan
- [ ] `pnpm typecheck && pnpm -F web lint && pnpm test` all green
- [ ] Migration applied locally; columns visible in Neon
- [ ] Producer can create + edit per-song product end-to-end
- [ ] Artist can book per-song product, sees correct total
- [ ] Producer dashboard shows "× N songs" on booking row
- [ ] Existing flat-price products unaffected

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 3: Wait for Vercel preview "Ready"**

Per memory `feedback_vercel_preview_sso_401.md`: don't probe HTML for status. Read the Vercel bot's "Ready" status from PR comments.

**Step 4: Apply migration to production database**

Per memory `feedback_migrations_not_auto_applied.md`: Gili must manually run `node packages/db/apply-migrations.mjs` against the prod DATABASE_URL AFTER PR merges. Mark this as a TODO in the PR body for Gili.

---

## Done definition

- [ ] All 20 tasks complete
- [ ] All commits pushed to `per-song-pricing-design` branch
- [ ] PR open against `v3-clean` with passing checks
- [ ] Manual smoke test recorded in PR comments
- [ ] Migration applied to local DB (production migration deferred to post-merge per Skitza process)

---

## File-touch summary

| File | Action |
|---|---|
| `apps/web/src/lib/pricing.ts` | Create |
| `apps/web/src/lib/__tests__/pricing.test.ts` | Create |
| `packages/db/src/schema.ts` (bookings table) | Modify — add 2 columns |
| `packages/db/drizzle/<MIG>_*.sql` | Generated |
| `apps/web/src/app/(producer)/dashboard/store/product-editor.tsx` | Modify — extend Draft |
| `apps/web/src/app/(producer)/dashboard/store/editor-steps/pricing-step.tsx` | Modify — toggle + per-song panel + live preview |
| `apps/web/src/app/(producer)/dashboard/store/__tests__/pricing-step.test.tsx` | Create |
| `apps/web/src/app/(producer)/dashboard/booking/actions.ts` | Modify — accept new fields |
| `apps/web/src/app/(producer)/dashboard/booking/__tests__/actions-per-song.test.ts` | Create |
| `apps/web/src/components/artist/store/product-card.tsx` | Modify — "From $X/song" copy |
| `apps/web/src/components/artist/store/__tests__/product-card.test.tsx` | Create |
| `apps/web/src/app/(artist)/artist/store/[productId]/song-count-stepper.tsx` | Create |
| `apps/web/src/app/(artist)/artist/store/[productId]/__tests__/song-count-stepper.test.tsx` | Create |
| `apps/web/src/app/(artist)/artist/store/[productId]/store-product-client.tsx` | Modify — wire stepper |
| `apps/web/src/app/(artist)/artist/store/[productId]/actions.ts` | Modify — persist qty + unit |
| `apps/web/src/app/(artist)/artist/store/[productId]/__tests__/actions.test.ts` | Create |
| Producer dashboard booking-row components | Modify — "× N songs" copy |
