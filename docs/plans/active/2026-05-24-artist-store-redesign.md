# Artist Store Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the flat product list at `/artist/store` with a boutique storefront per producer — hero + focal product card + quiet "Also from" list.

**Architecture:** Server components inside a single centered column. No new routes, no schema changes, no new tRPC procedures. The existing `artist.store.products({ producerId })` already returns products in the producer's drag-order (verified at [artist.ts:1304](apps/web/src/server/trpc/routers/artist.ts:1304)), so `products[0]` is the focal pick. The in-page `store-producer-picker.tsx` is deleted — the chrome `StudioSwitcher` (mobile top bar + desktop sidebar) handles producer switching.

**Tech Stack:** Next.js 15 App Router server components, Tailwind v4 with CSS variable tokens, tRPC v11, Vitest (`node` env, source-grep tests — no DOM, no `@testing-library/react`).

**Design brief:** [docs/plans/active/2026-05-24-artist-store-redesign-design.md](docs/plans/active/2026-05-24-artist-store-redesign-design.md)

**Linear:** [SK-34](https://linear.app/raz-stamper/issue/SK-34/artist-store-redesign-boutique-storefront-per-producer)

**Branch:** `giasraf/sk-34-artist-store-redesign-boutique-storefront-per-producer` (off `v3-clean`, already created, design doc committed at c1f4743)

**House style anchors (must follow):**
- CSS tokens that exist: `--bg-base`, `--bg-elevated`, `--bg-sunken`, `--bg-sidebar`, `--bg-overlay`, `--fg-default`, `--fg-secondary`, `--fg-muted`, `--fg-faint`, `--fg-onsidebar`, `--fg-inverse`, `--border-subtle`, `--brand-primary`, `--brand-copper`, `--brand-accent`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-2xl`, `--shadow-sm`, `--shadow-lg`. Tokens like `--surface-card`, `--text-strong`, `--text-muted`, `--surface-hover`, `--brand-primary-on` **do not exist** — using them produces transparent bg + invisible text.
- Buttons / rectangles: `rounded-[var(--radius-lg)]` (16px). Reserve `rounded-full` for square elements only (avatars, icon buttons, dots).
- Entrance motion: add `.reveal-up` class to top-level blocks (already in global CSS).
- Press feedback on tap targets: `sk-press` class.

---

## Task 0: Verify branch + clean tree

**Step 1:** Run `git status && git branch --show-current` and confirm:
- Branch: `giasraf/sk-34-artist-store-redesign-boutique-storefront-per-producer`
- Working tree clean
- Last commit: `c1f4743 docs(artist/store): SK-34 design brief — boutique storefront per producer`

**Step 2:** Move the Linear issue to "In Progress" before any code (per CLAUDE.md Linear workflow). Use the Linear MCP `save_issue` tool: `{ id: "SK-34", state: "In Progress" }`.

---

## Task 1: Extract shared price-label helper (TDD)

**Goal:** Move `formatCents`, `planLabel`, `formatPriceLabel` out of the current `product-card.tsx` so the new `FocalProductCard` + `QuietProductList` can share the same formatters.

**Files:**
- Create: `apps/web/src/lib/store/format-price-label.ts`
- Create: `apps/web/src/lib/store/__tests__/format-price-label.test.ts`

**Step 1: Write the failing tests**

Create `apps/web/src/lib/store/__tests__/format-price-label.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  formatCents,
  formatPriceLabel,
  planLabel,
} from "../format-price-label";

describe("formatCents", () => {
  it("renders USD with $ glyph", () => {
    expect(formatCents(12_50, "USD")).toBe("$12.5");
  });
  it("renders ILS with ₪ glyph", () => {
    expect(formatCents(10_000, "ILS")).toBe("₪100");
  });
  it("falls back to currency code when unknown", () => {
    expect(formatCents(5_00, "JPY")).toBe("JPY 5");
  });
});

describe("planLabel", () => {
  it("maps each pricing model to its label", () => {
    expect(planLabel("flat")).toBe("pay once");
    expect(planLabel("per_song")).toBe("per song");
    expect(planLabel("hourly")).toBe("per hour");
    expect(planLabel("bundle")).toBe("bundle");
  });
});

describe("formatPriceLabel", () => {
  it("flat → straight currency", () => {
    expect(
      formatPriceLabel({
        priceCents: 100_00,
        currency: "USD",
        pricingModel: "flat",
        volumeTiers: null,
      }),
    ).toBe("$100");
  });

  it("per_song with tiers → 'From $X/song'", () => {
    expect(
      formatPriceLabel({
        priceCents: 0,
        currency: "USD",
        pricingModel: "per_song",
        volumeTiers: [
          { minQty: 1, pricePerUnitCents: 50_00 },
          { minQty: 5, pricePerUnitCents: 40_00 },
        ],
      }),
    ).toMatch(/from \$40\/song/i);
  });

  it("per_song with no tiers + no price → 'Variable'", () => {
    expect(
      formatPriceLabel({
        priceCents: 0,
        currency: "USD",
        pricingModel: "per_song",
        volumeTiers: null,
      }),
    ).toBe("Variable");
  });

  it("hourly → 'from $X'", () => {
    expect(
      formatPriceLabel({
        priceCents: 60_00,
        currency: "USD",
        pricingModel: "hourly",
        volumeTiers: null,
      }),
    ).toBe("from $60");
  });
});
```

**Step 2: Run test, confirm RED**

```bash
cd "/Users/giliasraf/Skitza 16.4" && pnpm -F web test format-price-label
```

Expected: FAIL — `Cannot find module '../format-price-label'`.

**Step 3: Implement the helper**

Create `apps/web/src/lib/store/format-price-label.ts`:

```ts
import { fromPrice, type VolumeTier } from "~/lib/pricing";

// Currency glyph map — mirror the one in artist.ts; keep in sync if a
// new currency is added.
const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
};

const PLAN_LABELS: Record<
  "flat" | "per_song" | "hourly" | "bundle",
  string
> = {
  flat: "pay once",
  per_song: "per song",
  hourly: "per hour",
  bundle: "bundle",
};

export function formatCents(cents: number, currency: string): string {
  const prefix = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const major = (cents / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
  return `${prefix}${major}`;
}

export function planLabel(
  model: "flat" | "per_song" | "hourly" | "bundle",
): string {
  return PLAN_LABELS[model];
}

export function formatPriceLabel(product: {
  priceCents: number;
  currency: string;
  pricingModel: "flat" | "per_song" | "hourly" | "bundle";
  volumeTiers: VolumeTier[] | null;
}): string {
  if (product.pricingModel === "per_song") {
    const tiers = product.volumeTiers ?? [];
    const minCents = tiers.length > 0 ? fromPrice(tiers) : product.priceCents;
    return minCents > 0
      ? `From ${formatCents(minCents, product.currency)}/song`
      : "Variable";
  }
  if (product.pricingModel === "hourly") {
    return product.priceCents > 0
      ? `from ${formatCents(product.priceCents, product.currency)}`
      : "Variable";
  }
  return formatCents(product.priceCents, product.currency);
}
```

**Step 4: Run tests, confirm GREEN**

```bash
pnpm -F web test format-price-label
```

Expected: PASS (all 4 describes green).

**Step 5: Commit**

```bash
git add apps/web/src/lib/store/format-price-label.ts apps/web/src/lib/store/__tests__/format-price-label.test.ts
git commit -m "$(cat <<'EOF'
refactor(artist/store): extract shared price-label helper

Moves formatCents + planLabel + formatPriceLabel out of the artist
ProductCard so the upcoming FocalProductCard + QuietProductList can
share one source of truth. No behavior change; the helper is pure +
covered by unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: ProducerHero component (TDD, source-grep style)

**Goal:** A reusable hero with soft brand-primary → copper gradient, logo circle overlapping the bottom edge, producer name in display font below.

**Files:**
- Create: `apps/web/src/components/artist/store/producer-hero.tsx`
- Create: `apps/web/src/components/artist/store/__tests__/producer-hero.test.ts`

**Step 1: Write the failing source-grep tests**

Create `apps/web/src/components/artist/store/__tests__/producer-hero.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const COMPONENT_PATH = join(here, "..", "producer-hero.tsx");
const source = readFileSync(COMPONENT_PATH, "utf8");

describe("ProducerHero", () => {
  it("exports a ProducerHero function", () => {
    expect(source).toMatch(/export function ProducerHero/);
  });

  it("accepts producerName + producerLogoUrl props", () => {
    expect(source).toMatch(/producerName/);
    expect(source).toMatch(/producerLogoUrl/);
  });

  it("uses the brand-primary → brand-copper gradient on the cover block", () => {
    expect(source).toMatch(/var\(--brand-primary\)/);
    expect(source).toMatch(/var\(--brand-copper\)/);
  });

  it("renders the producer name in font-display", () => {
    expect(source).toMatch(/font-display/);
    expect(source).toMatch(/producerName/);
  });

  it("renders a logo circle (rounded-full) overlapping the gradient", () => {
    expect(source).toMatch(/rounded-full/);
  });

  it("falls back to an initial letter when no logo url", () => {
    expect(source).toMatch(/charAt\(0\)/);
  });

  it("entrance animation uses reveal-up", () => {
    expect(source).toMatch(/reveal-up/);
  });

  it("renders on an elevated surface (bg-elevated)", () => {
    expect(source).toMatch(/var\(--bg-elevated\)/);
  });
});
```

**Step 2: Run test, confirm RED**

```bash
pnpm -F web test producer-hero
```

Expected: FAIL — `ENOENT: producer-hero.tsx`.

**Step 3: Implement the component**

Create `apps/web/src/components/artist/store/producer-hero.tsx`:

```tsx
// Producer hero — boutique storefront header for /artist/store.
//
// Composition: soft brand-primary → copper gradient cover block, with
// the producer's logo (or initial fallback) as a circle that overlaps
// the bottom edge of the gradient onto the elevated card below. Name
// in display font under the logo. No meta, no profile link — the
// design brief keeps v1 pure.
export function ProducerHero({
  producerName,
  producerLogoUrl,
}: {
  producerName: string;
  producerLogoUrl: string | null;
}) {
  const initial = producerName.charAt(0).toUpperCase();
  return (
    <section
      aria-label={`${producerName} storefront`}
      className="reveal-up overflow-hidden rounded-[var(--radius-2xl)]"
      style={{
        background: "rgb(var(--bg-elevated))",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        aria-hidden
        className="h-32 sm:h-40"
        style={{
          background:
            "linear-gradient(135deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-copper)) 100%)",
        }}
      />
      <div className="relative px-5 pb-6 pt-10 sm:px-6 sm:pb-7 sm:pt-12">
        {/* Logo circle — overlaps the gradient via -translate-y-1/2.
            The ring matches the card surface so the circle reads as
            "punched through" the gradient, not floated on it. */}
        <div className="absolute -top-8 left-5 sm:-top-10 sm:left-6">
          {producerLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={producerLogoUrl}
              alt=""
              className="h-16 w-16 rounded-full object-cover ring-4 sm:h-20 sm:w-20"
              style={{ boxShadow: "var(--shadow-sm)" }}
            />
          ) : (
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[rgb(var(--brand-primary)/0.7)] to-[rgb(var(--brand-accent)/0.5)] font-display text-2xl font-bold text-[rgb(var(--fg-inverse))] ring-4 sm:h-20 sm:w-20"
              style={{ boxShadow: "var(--shadow-sm)" }}
            >
              {initial}
            </div>
          )}
        </div>
        <h2
          className="font-display text-[24px] font-extrabold leading-none tracking-[-0.025em] text-[rgb(var(--fg-default))] sm:text-[28px]"
        >
          {producerName}
        </h2>
      </div>
    </section>
  );
}
```

Note: the ring color (`ring-4`) is intentionally left without a Tailwind color class so it inherits `--bg-elevated` via the `style` on the parent. If lint complains about the eslint-disable comment placement, move it directly above the `<img>` element.

**Step 4: Run tests, confirm GREEN**

```bash
pnpm -F web test producer-hero
```

Expected: PASS (all 8 expectations).

**Step 5: Commit**

```bash
git add apps/web/src/components/artist/store/producer-hero.tsx apps/web/src/components/artist/store/__tests__/producer-hero.test.ts
git commit -m "$(cat <<'EOF'
feat(artist/store): ProducerHero — gradient cover + overlapping logo

The boutique storefront header. Brand-primary → copper gradient cover,
logo circle overlapping the bottom edge onto the elevated card, name
in font-display below. Falls back to initial-letter circle when no
logo url. No meta line, no profile link — v1 stays pure per design
brief.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: FocalProductCard component (TDD)

**Goal:** The full-width focal card for the producer's first product. Title + meta + description + price + primary CTA + small "Stripe · soon" footnote below the CTA.

**Files:**
- Create: `apps/web/src/components/artist/store/focal-product-card.tsx`
- Create: `apps/web/src/components/artist/store/__tests__/focal-product-card.test.ts`

**Step 1: Write the failing source-grep tests**

Create `apps/web/src/components/artist/store/__tests__/focal-product-card.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const COMPONENT_PATH = join(here, "..", "focal-product-card.tsx");
const source = readFileSync(COMPONENT_PATH, "utf8");

describe("FocalProductCard", () => {
  it("exports a FocalProductCard function", () => {
    expect(source).toMatch(/export function FocalProductCard/);
  });

  it("uses the shared price-label helper (no inline formatters)", () => {
    expect(source).toMatch(/from\s+['"]~\/lib\/store\/format-price-label['"]/);
    expect(source).toMatch(/formatPriceLabel/);
  });

  it("renders the title in font-display", () => {
    expect(source).toMatch(/font-display/);
    expect(source).toMatch(/product\.name/);
  });

  it("renders the description with line-clamp-2", () => {
    expect(source).toMatch(/line-clamp-2/);
    expect(source).toMatch(/product\.description/);
  });

  it("links the primary CTA to /artist/store/{id}", () => {
    expect(source).toMatch(/\/artist\/store\/\$\{product\.id\}/);
    expect(source).toMatch(/View details/);
  });

  it("uses the sidebar surface for the primary CTA", () => {
    expect(source).toMatch(/var\(--bg-sidebar\)/);
    expect(source).toMatch(/var\(--fg-onsidebar\)/);
  });

  it("uses rounded-[var(--radius-lg)] on the card (not rounded-full)", () => {
    expect(source).toMatch(/rounded-\[var\(--radius-lg\)\]/);
  });

  it("renders Stripe · soon as a quiet footnote (mono uppercase)", () => {
    expect(source).toMatch(/Stripe/);
    expect(source).toMatch(/uppercase/);
    expect(source).toMatch(/font-mono/);
  });

  it("renders the tax footnote when taxMode is set", () => {
    expect(source).toMatch(/taxMode/);
    expect(source).toMatch(/taxRatePct/);
    expect(source).toMatch(/taxModeFootnote/);
  });

  it("entrance animation uses reveal-up", () => {
    expect(source).toMatch(/reveal-up/);
  });
});
```

**Step 2: Run test, confirm RED**

```bash
pnpm -F web test focal-product-card
```

Expected: FAIL — file does not exist.

**Step 3: Implement the component**

Create `apps/web/src/components/artist/store/focal-product-card.tsx`:

```tsx
import Link from "next/link";

import { formatPriceLabel, planLabel } from "~/lib/store/format-price-label";
import type { VolumeTier } from "~/lib/pricing";
import { type TaxMode, taxModeFootnote } from "~/lib/tax-mode";

// Producer's flagship offer — full-width focal card at the top of
// each storefront. Title block left, price block right, description
// underneath, full-width "View details" CTA, "Stripe · soon" as a
// quiet centered footnote below the CTA so it reads as a coming-soon
// disclosure, not a competing sibling action.
export function FocalProductCard({
  product,
  taxMode = "tax_free",
  taxRatePct = 18,
}: {
  product: {
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    currency: string;
    pricingModel: "flat" | "per_song" | "hourly" | "bundle";
    volumeTiers: VolumeTier[] | null;
    sessionCount: number | null;
    durationMin: number | null;
  };
  taxMode?: TaxMode;
  taxRatePct?: number;
}) {
  const priceLabel = formatPriceLabel(product);
  const taxFootnote = taxModeFootnote(taxMode, taxRatePct);

  const meta: string[] = [];
  if (product.pricingModel === "per_song") {
    meta.push("PER SONG");
    if ((product.volumeTiers?.length ?? 0) >= 2) {
      meta.push("DISCOUNTS FOR BIGGER PROJECTS");
    }
  } else {
    meta.push(planLabel(product.pricingModel).toUpperCase());
  }
  if (product.sessionCount && product.sessionCount > 0) {
    meta.push(
      `${String(product.sessionCount)}× ${product.sessionCount > 1 ? "SESSIONS" : "SESSION"}`,
    );
  }
  if (product.durationMin) {
    meta.push(`${String(product.durationMin)} MIN`);
  }

  return (
    <article
      className="reveal-up rounded-[var(--radius-lg)] border p-6 sm:p-8"
      style={{
        background: "rgb(var(--bg-elevated))",
        borderColor: "rgb(var(--border-subtle))",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3
            className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-[rgb(var(--fg-default))] sm:text-[24px]"
          >
            {product.name}
          </h3>
          {meta.length > 0 ? (
            <p
              className="mt-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]"
            >
              {meta.join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className="shrink-0 font-mono text-[22px] font-extrabold tabular-nums text-[rgb(var(--fg-default))]"
            style={{ letterSpacing: "-0.02em" }}
          >
            {priceLabel}
          </span>
          {taxFootnote ? (
            <span
              className="flex items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-[0.06em] tabular-nums text-[rgb(var(--fg-muted))]"
            >
              <span
                aria-hidden
                className="inline-block h-1 w-1 rounded-full bg-[rgb(var(--fg-faint))]"
              />
              {taxFootnote}
            </span>
          ) : null}
        </div>
      </div>

      {product.description ? (
        <p className="mt-3 line-clamp-2 text-[13.5px] leading-relaxed text-[rgb(var(--fg-secondary))]">
          {product.description}
        </p>
      ) : null}

      <Link
        href={`/artist/store/${product.id}`}
        className="sk-press mt-5 flex w-full items-center justify-center rounded-[var(--radius-lg)] py-3 text-[14px] font-bold"
        style={{
          background: "rgb(var(--bg-sidebar))",
          color: "rgb(var(--fg-onsidebar))",
        }}
      >
        View details
      </Link>

      <p
        className="mt-3 text-center font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[rgb(var(--fg-faint))]"
      >
        Stripe · payments soon
      </p>
    </article>
  );
}
```

**Step 4: Run tests, confirm GREEN**

```bash
pnpm -F web test focal-product-card
```

Expected: PASS (10 expectations).

**Step 5: Commit**

```bash
git add apps/web/src/components/artist/store/focal-product-card.tsx apps/web/src/components/artist/store/__tests__/focal-product-card.test.ts
git commit -m "$(cat <<'EOF'
feat(artist/store): FocalProductCard — producer's flagship offer

Full-width card with title (font-display) + uppercase meta line +
description (2-line clamp) + price block (mono extrabold) + full-width
'View details' CTA + Stripe·soon centered as a quiet footnote below
the CTA. Reuses the shared price-label helper. Tax footnote keeps the
existing dot+pct disclosure pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: QuietProductList component (TDD)

**Goal:** Below the focal card, a quiet "Also from [Producer]" eyebrow + 1-column list of slim borderless rows for the remaining products. Whole row is the link target.

**Files:**
- Create: `apps/web/src/components/artist/store/quiet-product-list.tsx`
- Create: `apps/web/src/components/artist/store/__tests__/quiet-product-list.test.ts`

**Step 1: Write the failing source-grep tests**

Create `apps/web/src/components/artist/store/__tests__/quiet-product-list.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const COMPONENT_PATH = join(here, "..", "quiet-product-list.tsx");
const source = readFileSync(COMPONENT_PATH, "utf8");

describe("QuietProductList", () => {
  it("exports a QuietProductList function", () => {
    expect(source).toMatch(/export function QuietProductList/);
  });

  it("renders an 'Also from {producerName}' eyebrow in mono uppercase", () => {
    expect(source).toMatch(/Also from/);
    expect(source).toMatch(/font-mono/);
    expect(source).toMatch(/uppercase/);
    expect(source).toMatch(/producerName/);
  });

  it("uses the shared price-label helper for each row", () => {
    expect(source).toMatch(/from\s+['"]~\/lib\/store\/format-price-label['"]/);
    expect(source).toMatch(/formatPriceLabel/);
  });

  it("links each row to /artist/store/{id}", () => {
    expect(source).toMatch(/\/artist\/store\/\$\{/);
  });

  it("renders nothing when products list is empty", () => {
    // Early-return guard — the page composer should not mount this
    // component for a single-product storefront, but the safety guard
    // here keeps callers from rendering a stray eyebrow on an empty
    // list.
    expect(source).toMatch(/products\.length\s*===\s*0/);
  });

  it("uses sk-press for tap feedback on the row link", () => {
    expect(source).toMatch(/sk-press/);
  });

  it("entrance animation uses reveal-up", () => {
    expect(source).toMatch(/reveal-up/);
  });
});
```

**Step 2: Run test, confirm RED**

```bash
pnpm -F web test quiet-product-list
```

Expected: FAIL.

**Step 3: Implement the component**

Create `apps/web/src/components/artist/store/quiet-product-list.tsx`:

```tsx
import Link from "next/link";

import { formatPriceLabel } from "~/lib/store/format-price-label";
import type { VolumeTier } from "~/lib/pricing";

// "Also from {Producer}" — the quiet tail under the focal card.
// Borderless rows with hairline dividers, whole row tappable. Meta
// trimmed to one short signal per row since the focal card already
// taught the artist what each product type looks like.
export function QuietProductList({
  producerName,
  products,
}: {
  producerName: string;
  products: {
    id: string;
    name: string;
    priceCents: number;
    currency: string;
    pricingModel: "flat" | "per_song" | "hourly" | "bundle";
    volumeTiers: VolumeTier[] | null;
    sessionCount: number | null;
    durationMin: number | null;
  }[];
}) {
  if (products.length === 0) return null;

  return (
    <section className="reveal-up">
      <p
        className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]"
      >
        Also from {producerName}
      </p>
      <ul className="overflow-hidden rounded-[var(--radius-lg)]" style={{ background: "rgb(var(--bg-elevated))", boxShadow: "var(--shadow-sm)" }}>
        {products.map((product, i) => {
          const isLast = i === products.length - 1;
          const meta = shortMeta(product);
          return (
            <li key={product.id}>
              <Link
                href={`/artist/store/${product.id}`}
                className={`sk-press flex items-baseline justify-between gap-3 px-4 py-3.5 ${
                  isLast ? "" : "border-b"
                }`}
                style={{
                  borderColor: "rgb(var(--border-subtle))",
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-[rgb(var(--fg-default))]">
                    {product.name}
                  </p>
                  {meta ? (
                    <p
                      className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]"
                    >
                      {meta}
                    </p>
                  ) : null}
                </div>
                <span
                  className="shrink-0 font-mono text-[14px] font-bold tabular-nums text-[rgb(var(--fg-default))]"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  {formatPriceLabel(product)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function shortMeta(product: {
  pricingModel: "flat" | "per_song" | "hourly" | "bundle";
  sessionCount: number | null;
  durationMin: number | null;
}): string | null {
  if (product.pricingModel === "per_song") return "PER SONG";
  if (product.pricingModel === "hourly") {
    return product.durationMin
      ? `${String(product.durationMin)} MIN MIN`
      : "PER HOUR";
  }
  if (product.sessionCount && product.sessionCount > 0) {
    return `${String(product.sessionCount)}× SESSION${product.sessionCount > 1 ? "S" : ""}`;
  }
  if (product.durationMin) return `${String(product.durationMin)} MIN`;
  return null;
}
```

**Step 4: Run tests, confirm GREEN**

```bash
pnpm -F web test quiet-product-list
```

Expected: PASS (7 expectations).

**Step 5: Commit**

```bash
git add apps/web/src/components/artist/store/quiet-product-list.tsx apps/web/src/components/artist/store/__tests__/quiet-product-list.test.ts
git commit -m "$(cat <<'EOF'
feat(artist/store): QuietProductList — 'Also from {Producer}' tail

Borderless 1-column list with mono uppercase eyebrow + slim rows.
Whole row tappable, hairline dividers between, no card chrome per
row (the focal card is the only card on the page). Returns null on
empty product list so callers don't have to gate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Rewrite the store page

**Goal:** Wire the three new components into a single centered column. Handle empty / single-product / zero-producer edge cases. Delete the in-page producer picker.

**Files:**
- Modify: `apps/web/src/app/(artist)/artist/store/page.tsx`
- Delete: `apps/web/src/app/(artist)/artist/store/store-producer-picker.tsx`

**Step 1: Read the current router shape**

Confirm `caller.artist.store.products({ producerId })` returns rows already ordered by `products.position` ascending. Verified at [artist.ts:1304](apps/web/src/server/trpc/routers/artist.ts:1304). No router change.

**Step 2: Rewrite `page.tsx`**

Replace the file at `apps/web/src/app/(artist)/artist/store/page.tsx`:

```tsx
import { auth } from "@clerk/nextjs/server";

import { FocalProductCard } from "~/components/artist/store/focal-product-card";
import { ProducerHero } from "~/components/artist/store/producer-hero";
import { QuietProductList } from "~/components/artist/store/quiet-product-list";
import { coerceTaxMode } from "~/lib/tax-mode";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { searchParams: Promise<{ studio?: string }> };

// Boutique storefront per producer. The chrome StudioSwitcher
// (mobile top bar + desktop sidebar) writes ?studio=<id>; we resolve
// the active producer, the producer's products (ordered by drag
// position), and render hero → focal → "Also from" list.
//
// Edge cases:
//   • zero studios  → EmptyStudios card (reused shape from /artist/book)
//   • zero products → hero + "still setting up" soft card
//   • one product   → hero + focal only (no QuietProductList)
//
// The artist layout already gates sign-in; the auth() call here is
// defense-in-depth, matching the other tabs.
export default async function StorePage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  const sp = await searchParams;

  const { studios } = await caller.artist.studios();
  if (studios.length === 0) {
    return (
      <div className="reveal-up mx-auto w-full max-w-[600px] lg:max-w-[760px]">
        <StoreEyebrow />
        <EmptyStudios />
      </div>
    );
  }

  // Active producer: ?studio= wins, else first studio (artist.studios
  // returns them desc by lastSeenAt server-side).
  const activeStudio =
    studios.find((s) => s.producerId === sp.studio) ?? studios[0];

  const { products } = await caller.artist.store.products({
    producerId: activeStudio.producerId,
  });

  const [focal, ...rest] = products;

  // VAT context lives on the producer (migration 0019). All products
  // in this storefront inherit it from the active producer's row, so
  // we read it off the first product if present, else fall back.
  const taxMode = coerceTaxMode(focal?.producerTaxMode ?? "tax_free");
  const taxRatePct = focal?.producerTaxRatePct ?? 18;

  return (
    <div className="mx-auto w-full max-w-[600px] space-y-6 lg:max-w-[760px]">
      <StoreEyebrow />
      <ProducerHero
        producerName={activeStudio.producerName}
        producerLogoUrl={activeStudio.producerLogoUrl}
      />
      {focal ? (
        <FocalProductCard
          product={{
            id: focal.id,
            name: focal.name,
            description: focal.description,
            priceCents: focal.priceCents,
            currency: focal.currency,
            pricingModel: focal.pricingModel,
            volumeTiers: focal.volumeTiers,
            sessionCount: focal.sessionCount,
            durationMin: focal.durationMin,
          }}
          taxMode={taxMode}
          taxRatePct={taxRatePct}
        />
      ) : (
        <EmptyStorefront producerName={activeStudio.producerName} />
      )}
      <QuietProductList
        producerName={activeStudio.producerName}
        products={rest.map((p) => ({
          id: p.id,
          name: p.name,
          priceCents: p.priceCents,
          currency: p.currency,
          pricingModel: p.pricingModel,
          volumeTiers: p.volumeTiers,
          sessionCount: p.sessionCount,
          durationMin: p.durationMin,
        }))}
      />
    </div>
  );
}

// Tiny page-identity row. The producer hero carries the real visual
// weight; this stays a quiet route handle. Mirrors BookEyebrow.
function StoreEyebrow() {
  return (
    <header className="flex items-baseline justify-between px-1 sm:px-0">
      <h1 className="font-display text-[20px] font-extrabold leading-none tracking-[-0.025em] text-[rgb(var(--fg-default))]">
        Store
        <span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
      </h1>
    </header>
  );
}

// Soft empty state for a producer who hasn't published yet.
function EmptyStorefront({ producerName }: { producerName: string }) {
  return (
    <div
      className="reveal-up rounded-[var(--radius-lg)] border border-dashed px-5 py-6 text-center"
      style={{
        background: "rgb(var(--bg-sunken))",
        borderColor: "rgb(var(--border-subtle))",
      }}
    >
      <p className="text-[13px] text-[rgb(var(--fg-secondary))]">
        {producerName} is still setting up their store. Check back soon.
      </p>
    </div>
  );
}

// Reused shape from /artist/book's EmptyStudios. Kept local so the
// Store page doesn't depend on the Book page; if Raz later promotes
// this to a shared component, swap the import.
function EmptyStudios() {
  return (
    <section
      aria-label="No studios yet"
      className="overflow-hidden rounded-[var(--radius-2xl)] border bg-[rgb(var(--bg-elevated))]"
      style={{
        borderColor: "rgb(var(--border-subtle))",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <div
        aria-hidden
        className="flex h-28 items-center justify-center"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, rgb(var(--brand-primary) / 0.18), transparent 65%), rgb(var(--bg-overlay))",
        }}
      >
        <span
          className="font-mono text-[10px] font-bold uppercase tracking-[0.24em]"
          style={{ color: "rgb(var(--brand-primary))" }}
        >
          Waiting for an invite
        </span>
      </div>
      <div className="px-6 py-6 lg:px-8">
        <p className="font-display text-[20px] font-extrabold leading-tight tracking-[-0.02em] text-[rgb(var(--fg-default))]">
          No storefronts yet.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Once a producer connects you, their store appears here.
        </p>
      </div>
    </section>
  );
}
```

**Step 3: Delete the in-page producer picker**

```bash
git rm apps/web/src/app/\(artist\)/artist/store/store-producer-picker.tsx
```

**Step 4: Typecheck + lint (catches token typos, import drift)**

```bash
pnpm -F web typecheck && pnpm -F web lint
```

Expected: clean. If lint flags eslint-disable placement or unused imports, fix in place.

**Step 5: Commit**

```bash
git add apps/web/src/app/\(artist\)/artist/store/page.tsx
git commit -m "$(cat <<'EOF'
feat(artist/store): boutique storefront page wiring

Replaces the flat product list with: eyebrow → ProducerHero →
FocalProductCard (first product in producer's drag-order) →
QuietProductList. Single centered column, 600px mobile / 760px
desktop. Deletes the in-page producer picker — the chrome
StudioSwitcher handles producer switching. Edge cases covered: zero
studios → 'Waiting for an invite' card; zero products → soft 'still
setting up' card; one product → hero + focal only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Retire the old ProductCard

**Goal:** With the new components shipping, the old `apps/web/src/components/artist/store/product-card.tsx` and its test are no longer imported anywhere. Delete them.

**Step 1: Confirm zero call sites**

```bash
cd "/Users/giliasraf/Skitza 16.4" && grep -rn "from .*components/artist/store/product-card" apps/web/src 2>/dev/null
```

Expected: no output.

**Step 2: Delete**

```bash
git rm apps/web/src/components/artist/store/product-card.tsx apps/web/src/components/artist/store/__tests__/product-card.test.ts
```

**Step 3: Typecheck (catches any leftover imports)**

```bash
pnpm -F web typecheck
```

Expected: clean.

**Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(artist/store): drop legacy ProductCard (replaced by Focal+QuietList)

The flat product card has no remaining call sites — its job is now
split between FocalProductCard (producer's flagship) and
QuietProductList (the 'Also from' tail). Price-label helpers moved
to lib/store/format-price-label in Task 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Full verification gate

**Step 1: Run the Skitza verify pipeline**

```bash
cd "/Users/giliasraf/Skitza 16.4" && pnpm typecheck && pnpm -F web lint && pnpm test
```

Equivalent to `/skitza-verify`. All three must pass — Vercel's build runs ESLint with `--max-warnings 0`, so lint warnings break the deploy.

Expected: green across the board.

**Step 2: Manual smoke check (browser)**

Start dev: `pnpm -F web dev`. Visit `http://localhost:3000/artist/store`. Verify:

| Scenario | Steps | Expected |
|---|---|---|
| 1 producer, many products | (default for most test users) | Hero with gradient + logo + name. Focal card with first product, full-width CTA. "Also from {name}" eyebrow + slim rows below. |
| 1 producer, 1 product | Filter to a producer with one product | Hero + focal only. No "Also from" eyebrow. |
| 1 producer, 0 products | Filter to a producer who hasn't published | Hero + soft "still setting up" card. No "Also from". |
| 2+ producers | Click chrome StudioSwitcher in mobile top bar (mobile) or desktop sidebar (desktop) | Page swaps to other producer's storefront. URL updates `?studio=<id>`. No in-page avatar row. |
| 0 producers | Sign in as artist with no studios | "Waiting for an invite" card. No hero. |

**Step 3: Manual mobile check**

Open Chrome devtools → toggle device toolbar → iPhone 14 Pro. Verify:
- Single column, 600px max, centered.
- Logo circle reads as overlapping the gradient bottom edge.
- Focal card padding feels generous (24px), not cramped.
- "Also from" rows are tappable, hairline dividers visible.
- No horizontal scroll anywhere.

**Step 4: No commit** — this task is verification only.

---

## Task 8: Open the PR

**Step 1: Push the branch**

```bash
git push -u origin giasraf/sk-34-artist-store-redesign-boutique-storefront-per-producer
```

**Step 2: Open the PR against v3-clean**

```bash
gh pr create --base v3-clean --title "SK-34: artist store — boutique storefront per producer" --body "$(cat <<'EOF'
## Summary
- Replaces the flat `/artist/store` product list with a boutique storefront per producer: `ProducerHero` (gradient + logo + name) → `FocalProductCard` (producer's drag-first product) → `QuietProductList` ("Also from {Producer}" tail).
- Deletes the in-page `store-producer-picker.tsx`. The chrome `StudioSwitcher` (mobile top bar + desktop sidebar) handles producer switching, matching `/artist/book`.
- Same shape mobile + desktop. 600px / 760px max column. No new routes, no schema changes, no new tRPC procedures.

## Design brief
[docs/plans/active/2026-05-24-artist-store-redesign-design.md](docs/plans/active/2026-05-24-artist-store-redesign-design.md)

## Linear
[SK-34](https://linear.app/raz-stamper/issue/SK-34/artist-store-redesign-boutique-storefront-per-producer)

## Test plan
- [ ] `pnpm typecheck && pnpm -F web lint && pnpm test` green
- [ ] 1 producer with many products → hero + focal + "Also from"
- [ ] 1 producer with 1 product → hero + focal only
- [ ] 1 producer with 0 products → hero + soft "still setting up" card
- [ ] 2+ producers → chrome StudioSwitcher swaps storefronts, URL updates `?studio=<id>`
- [ ] 0 producers → "Waiting for an invite" card
- [ ] Mobile (iPhone 14 Pro) → single column, no horizontal scroll, logo overlap reads clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 3: Confirm PR opened and Linear auto-linked**

Visit the returned PR URL. Linear should move SK-34 to "In Review" automatically because the title matches `SK-34: ...`. If it doesn't, check the Linear integration on the PR's right rail.

---

## Definition of done

- [ ] All 8 tasks committed
- [ ] Verification gate green (`pnpm typecheck && pnpm -F web lint && pnpm test`)
- [ ] Manual smoke check passes for all 5 scenarios + mobile
- [ ] PR opened against `v3-clean` with `SK-34: ...` title
- [ ] Linear SK-34 moved to "In Review" (auto, via GitHub integration)

## Open hand-back to Raz (post-merge)

After Raz merges to `v3-clean`, Gili must promote to prod (Vercel's auto-build flags this as preview, not prod). Per memory: match `githubCommitSha` to the squash-merge SHA, then `vercel promote <dpl_id>` followed by `vercel alias set <dpl_id> skitza.app`.
