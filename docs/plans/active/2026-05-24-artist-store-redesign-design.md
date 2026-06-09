# Artist Store Redesign — Design Brief

> **For Claude:** Brainstorming output. Gili approved scope, structure, and visual direction in chat on 2026-05-24. Hand off to `superpowers:writing-plans` to convert into a step-by-step implementation plan before writing any code.

**Date:** 2026-05-24
**Author:** Claude (from Gili's brainstorm in chat)
**Status:** ✅ Approved by Gili
**Branch:** TBD — new branch off `v3-clean` once Linear issue exists
**Linear:** TBD — create issue in `Skitza v3` (team `SK`) titled "Artist store redesign — boutique storefront per producer"
**Related:** `apps/web/src/app/(artist)/artist/store/`, `apps/web/src/app/(artist)/artist/page.tsx` (SK-26 home pattern), `apps/web/src/app/(artist)/artist/book/page.tsx` (chrome studio switcher reference), `apps/web/src/components/artist/studio-switcher.tsx`, `apps/web/src/components/nav/artist-mobile-top-bar.tsx`, `apps/web/src/components/nav/artist-desktop-sidebar.tsx`, `CLAUDE.md` (Artist platform §5)

---

## 1. Why we're doing this

The current `/artist/store` reads like a spreadsheet:

- A flat list of identical product cards.
- An avatar-row producer picker at the top.
- No producer identity. No hierarchy. No grouping.
- Mobile is just a narrower desktop — no special layout.

Each artist can be connected to multiple producers (1–N studios). The current page treats every product the same, which makes a multi-producer artist's Store feel like an inbox dump rather than a curated shop.

Gili's goal: **make this feel premium, like a small boutique per producer — not Excel.**

## 2. The mental model

**Boutique per producer.** Each producer gets their own storefront. Walking from one producer's storefront to another feels like changing rooms. The Store tab is never "everyone's products mixed together."

This is a deliberate choice over a "mixed marketplace" model — the multi-producer relationship is intimate (artist worked with that producer), so the storefront should preserve each producer's voice.

## 3. Scope, confirmed in chat

| Decision | Answer |
|---|---|
| Mental model | One storefront per producer (boutique). Not a mixed marketplace. |
| Producer switching | Reuse the chrome `StudioSwitcher` (lives in `ArtistDesktopSidebar` + `ArtistMobileTopBar`) — same surface Book relies on. Remove the in-page `store-producer-picker.tsx`. |
| Producer identity | Big hero — logo + producer name + soft brand-primary→copper gradient. No meta line, no profile link in v1. |
| Layout inside a storefront | Focal product + quiet list. One big hero card on top, slim rows below under "Also from [Producer]" eyebrow. |
| Focal pick rule | First product in the producer's drag-order (from `/dashboard/store`). Respects producer intent, zero new UI. |
| Visual direction | "Editorial focal" — Apple News / Bandcamp feel. Soft gradient, warm but restrained. Not full-bleed cinematic, not minimal-flat. |
| Search / filter | None for v1. Inventory is typically small (3–8 products per producer). |
| Mobile vs desktop | Same shape, different widths. Single column 600px mobile, 760px desktop. No right rail. |
| Schema changes | None. Reuse all existing data. |
| Detail page (`/artist/store/[productId]`) | Out of scope for this redesign. |

## 4. Routing

| Path | Action |
|---|---|
| `/artist/store` | Active producer derived from `?studio=<id>` query param (already works). When absent, default to first studio (sorted by `lastSeenAt` desc — existing behavior in `artist.studios()`). |
| `/artist/store?studio=<producerId>` | Same page, scoped to that producer's storefront. The chrome `StudioSwitcher` (mobile top bar / desktop sidebar) updates this param. |
| `/artist/store/[productId]` | Unchanged. |

## 5. Page composition

Top to bottom inside a single centered column (`max-w-[600px]` mobile, `max-w-[760px]` desktop, `mx-auto`):

### 5.1 Eyebrow / page heading

Match the `/artist/book` "BookEyebrow" pattern. Small. The producer hero carries the real visual weight, so the page-identity row stays quiet.

```
Store.          [no right-side tag — Book has "Next 14 days"; Store has no equivalent]
```

- `h1`, `font-display`, ~20px, extrabold, `tracking-[-0.025em]`.
- The dot uses `rgb(var(--brand-primary))`.
- `px-1 sm:px-0`.

### 5.2 Producer hero

The headline of the storefront. Premium signature move.

- A wrapping section with `rounded-[var(--radius-2xl)]` and `overflow-hidden`, on `bg-[rgb(var(--bg-elevated))]` (so the gradient sits on the elevated surface, not the page).
- Inside, a **gradient block** ~140–160px tall (`h-32 sm:h-40`):
  - `background: linear-gradient(135deg, rgb(var(--brand-primary)) 0%, rgb(var(--brand-copper)) 100%)`.
- The **logo circle** (`64px` mobile, `80px` desktop) sits at the bottom-left of the gradient, overlapping the edge using `translate-y-1/2` and a 2–3px ring (`ring-2 ring-[rgb(var(--bg-elevated))]`) so it visually "punches through" the gradient onto the card below.
  - Fallback when `producerLogoUrl` is null: the same initial-circle treatment used by `ProducerPicker` (gradient `from-brand-primary/0.7 to-brand-accent/0.5`, white letter).
- Below the logo, the **producer name** in `font-display`, ~28px desktop / 24px mobile, extrabold, `tracking-[-0.025em]`. Left-aligned. Padding: `pt-10 pb-6 px-5 sm:pt-12 sm:pb-7 sm:px-6` (the `pt` is generous to clear the logo overlap).
- No meta line, no profile link. v1 keeps it pure.
- `.reveal-up` for entrance.

### 5.3 Focal product card

The producer's flagship offer. Visually anchors the storefront.

- `rounded-[var(--radius-lg)]` (16px), full-width inside column.
- `bg-[rgb(var(--bg-elevated))]`, `border border-[rgb(var(--border-subtle))]`, `shadow-[var(--shadow-sm)]`.
- Padding: `p-6 sm:p-8`.
- Layout: title block left, price block right (`flex items-start justify-between gap-4`).
  - **Title:** `font-display`, ~22–24px, bold, `tracking-tight`.
  - **Meta line** below title: small uppercase mono. Composed from existing fields, joined by `·`. Skip the producer name (already in hero).
    - For `flat`: `PAY ONCE · {sessionCount}× {durationMin}MIN` (only the parts that exist).
    - For `per_song`: `PER SONG · DISCOUNTS FOR BIGGER PROJECTS` (if ≥2 tiers).
    - For `hourly`: `PER HOUR · {durationMin}MIN MINIMUM` (if applicable).
    - For `bundle`: `BUNDLE`.
  - **Description:** 2-line clamp, ~14px, `text-[rgb(var(--fg-secondary))]`.
  - **Price block (right):** mono extra-bold, ~22px, tight letter-spacing. Reuse `formatPriceLabel` from existing `product-card.tsx`. VAT footnote below price (existing pattern from `taxModeFootnote`).
- Below the title row: a **primary CTA** — full-width button, `bg-[rgb(var(--bg-sidebar))]` + `text-[rgb(var(--fg-onsidebar))]`, `rounded-[var(--radius-lg)]`, ~`py-3`, `text-[14px] font-bold`. Label: "View details". Links to `/artist/store/[productId]`.
- The "Stripe · soon" pill stays as a small honest signal, but moves to a quiet position **below the CTA**, centered, mono uppercase, faint. (Today it sits to the right of the button — that placement competes with the CTA. Below + centered keeps it as a footnote, not a sibling.)
- `.reveal-up` for entrance.

### 5.4 Quiet list — "Also from [Producer]"

The remaining products. No card chrome — the focal card is the only "card" on the page.

- **Eyebrow:** "ALSO FROM [PRODUCER NAME]" in mono uppercase, 10px, `tracking-[0.18em]`, `text-[rgb(var(--fg-muted))]`. `mb-3`.
- **Rows:** flat list, no card backgrounds.
  - Each row is a `<Link>` to `/artist/store/[productId]`, the whole row clickable.
  - Layout: title + small mono meta on the left, price on the right (`flex items-baseline justify-between`).
  - Title: ~14px, bold, `text-[rgb(var(--fg-default))]`, single-line truncate.
  - Meta: ~11px mono uppercase, faint. Same composition rules as focal but **shorter** (only one or two parts — the focal card already taught the artist what each product type looks like).
  - Price: mono bold, ~14px, right-aligned. Same formatter as focal.
  - Hover: `bg-[rgb(var(--bg-sunken))]` subtle wash (rounded inside list for hit target). Press: `sk-press` class for haptic-feeling motion.
  - Hairline dividers between rows: `border-b border-[rgb(var(--border-subtle))]`, last row no border.
  - Vertical padding: `py-3.5 px-2`.
- `.reveal-up` on the section wrapper (not per row — staggers feel cheap here).

### 5.5 Edge cases

| Case | Behavior |
|---|---|
| **0 producers** | Reuse `EmptyStudios` component pattern from `/artist/book/page.tsx` (the polished "Waiting for an invite" card). Same shape so the artist sees consistency across tabs. |
| **0 products in this storefront** | Show the producer hero (5.2). Below it, a soft card on `bg-[rgb(var(--bg-sunken))]` with `border-dashed border-[rgb(var(--border-subtle))]`, copy: "[Producer name] is still setting up their store. Check back soon." No CTA. |
| **1 product only** | Hero (5.2) + focal card (5.3). No "Also from" eyebrow + list. |
| **Many products (8+)** | Same layout. The quiet list scrolls. No pagination in v1. |
| **No producer logo** | Initial-circle fallback (existing pattern, see `ProducerPicker`). |

## 6. Mobile vs desktop

Same shape on both. No mobile-specific layout, no desktop-specific rail.

- Mobile: `max-w-[600px]` (matches SK-26 home). Logo 64px. Hero pad `pt-10 pb-6`. Focal card pad `p-6`. Type sizes: hero name 24px, focal title 22px.
- Desktop: `max-w-[760px]` (Store is browse-heavy, no need for the 1128px home grid). Logo 80px. Hero pad `pt-12 pb-7`. Focal card pad `p-8`. Type sizes: hero name 28px, focal title 24px.
- Spacing between sections (eyebrow / hero / focal / list): `space-y-6`.

## 7. Components to add / change

| File | Action |
|---|---|
| `apps/web/src/app/(artist)/artist/store/page.tsx` | Rewrite. New composition: eyebrow → hero → focal → list. |
| `apps/web/src/app/(artist)/artist/store/store-producer-picker.tsx` | **Delete.** Switcher lives in the chrome (mobile top bar + desktop sidebar). |
| `apps/web/src/components/artist/store/producer-hero.tsx` | **NEW.** Server component. Props: `{ producerName, producerLogoUrl }`. |
| `apps/web/src/components/artist/store/focal-product-card.tsx` | **NEW.** Server component. Props: `{ product, taxMode, taxRatePct }`. Title + meta + description + price + CTA. |
| `apps/web/src/components/artist/store/quiet-product-list.tsx` | **NEW.** Server component. Props: `{ producerName, products, taxMode, taxRatePct }`. Eyebrow + list. |
| `apps/web/src/components/artist/store/product-card.tsx` | **Delete after migration** — its price formatter logic moves into a small helper (`format-price-label.ts`) shared by focal + quiet list. |
| `apps/web/src/components/artist/store/__tests__/product-card.test.ts` | Replace with tests for the new components + the extracted price-label helper. |
| `apps/web/src/lib/store/format-price-label.ts` | **NEW.** Extract `formatPriceLabel`, `formatCents`, `planLabel` from `product-card.tsx`. Used by focal + quiet list. |

## 8. Data plan

**No schema changes. No new tRPC procedures.**

The page already calls `artist.store.products({ producerId? })` and `artist.studios()`. Same calls, same data, presented differently.

Picking focal:
```ts
const [focal, ...rest] = products; // products already ordered by producer drag-order on server
```

The server-side `artist.store.products` query orders by the producer's `displayOrder` column (or equivalent — verify during implementation). If it doesn't yet, this is a 1-line `orderBy` change in `artist.ts`, not a schema change.

## 9. Motion

Reuse `.reveal-up` (existing CSS class) on each top-level block: hero, focal card, quiet list section. No per-row stagger.

## 10. Out of scope (deferred)

- Product images (no schema for them yet).
- Producer tagline / bio in hero.
- "View profile" link to `/join/<slug>`.
- Producer color theming (use brand-primary→copper gradient for everyone in v1).
- Search / filter / type chips.
- Sort.
- Detail page polish (`/artist/store/[productId]`).
- Producer-marked "featured" product (focal = first in order is enough for v1).
- Category sections (Sessions / Beat packs / Add-ons).
- Mobile swipe between producers.

## 11. Verification gate

Before pushing:
- `pnpm typecheck && pnpm -F web lint && pnpm test` all green.
- Manual check in `/artist/store` for: (a) one producer / no products, (b) one producer / one product, (c) one producer / many products, (d) two producers, switch via chrome `StudioSwitcher`, (e) zero producers.
- Run `/skitza-verify`.

## 12. Open questions deferred from this round

- **Do producers want to mark a product as featured?** Skipped v1 (first-in-order works). Revisit if real producers ask for it.
- **Do we need a "Compare plans" view inside the storefront?** Today the detail page handles this. Revisit if artist feedback shows confusion.
- **Tax mode display in the hero?** Right now per-product. If a producer's storefront has many products with the same tax mode, we could hoist it to the hero. Defer.
