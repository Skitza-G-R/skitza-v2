# Producer Storefront Redesign, Design Brief

> **For Claude:** Brainstorming output. Gili approved the scope, phasing, type mapping, and three small adaptations in chat on 2026-05-10. Convert this into an implementation plan via the `superpowers:writing-plans` skill before writing any code.

**Date:** 2026-05-10
**Author:** Claude (from Gili's scope answers in chat)
**Status:** ✅ Approved by Gili
**Branch:** `phase-1-store-redesign` off `v3-clean`
**Related:** `/Volumes/KINGSTON/Downloads/design_handoff_storefront/README.md` (handoff), `docs/product/PRD.md` §4.5 (Store), `CLAUDE.md` (Producer platform)

---

## 1. Why we're doing this

Gili commissioned a high-fidelity HTML design handoff for the producer Store page (`design_handoff_storefront/storefront.html`). It introduces a richer catalog UX: a giant `Store.` wordmark, type-tile cards (Mix / Master / Production / Consult), filter tabs, search, drag-to-reorder, a Cards/Table view toggle, and a redesigned full-screen Editor with type presets. The current `/dashboard/profile` Store tab is functional but visually generic, missing tile typology, missing filter/search, and missing reorder.

Constraints Gili named in chat:
- "TDD, careful, without breaking nothing"
- Phased rollout preferred (3 small PRs, not one big one)
- Don't pull in non-store concerns (no live-page link, no preview card, no stats card)

## 2. Scope, confirmed in chat

| Decision | Answer |
|---|---|
| Page structure | New design replaces the whole page. Portfolio moves to its own page. |
| Phasing | 3 phases. Same total scope as a big-bang ship. |
| Type tile taxonomy | 4 tiles only (Mix / Master / Production / Consult). Existing `kind` values auto-map per §4. |
| Off-design extras | Drop everything not in the handoff: live-page link, preview card, page-stats panel. |
| Delete behavior | "Delete" UX with 4.5s Undo. Soft-delete via existing `archivedAt` column. Booking history preserved. |
| Tagline | First line of `description`, single-line clamp. No schema change. |
| Featured chip | Removed from new card. Data stays in DB. |

## 3. Routing

| Path | Action |
|---|---|
| `/dashboard/store` | NEW. New design lives here. |
| `/dashboard/portfolio` | NEW. Existing `PortfolioPanel` mounts here, content unchanged. |
| `/dashboard/profile` | REDIRECT (308) to `/dashboard/store`. |
| `/dashboard/profile?tab=portfolio` | REDIRECT (308) to `/dashboard/portfolio`. |
| Sidebar (`producer-sidebar.tsx`) | `Store` href updated. New `Portfolio` item appended. |
| Bottom nav (`producer-bottom-nav.tsx`) | Same edits, mobile parity. |

## 4. Type tile mapping

The DB column `products.kind` is free text (Drizzle `text`). Existing values fan out to 4 tiles like this:

| `kind` value | Tile | Gradient | Lucide icon |
|---|---|---|---|
| `mix`, `mixing` | Mix | `linear-gradient(135deg, #d97706, #b45309)` | `sliders-horizontal` |
| `master`, `mastering` | Master | `linear-gradient(135deg, #c2410c, #9a3412)` | `volume-2` |
| `production`, `producing`, `album` | Production | `linear-gradient(135deg, #059669, #065f46)` | `music-2` |
| `session`, `consult`, `other`, `custom`, `hourly`, `beat_lease`, fallback | Consult | `linear-gradient(135deg, #475569, #1e293b)` | `message-square` |

Mapping lives in a single helper `kindToTile(kind: string): TileType` so re-tuning later is one-file. Editor (Phase 2) sets `kind` from the type-preset picker (`production` / `mix` / `master` / `consult`).

## 5. Phase 1, Visual shell

**Goal:** the new visual on `/dashboard/store` with filter, search, type tiles, cards, keyboard shortcuts. Edit and Create open the existing `NewPackageForm` (replaced in Phase 2). No drag, no functional Table view, no delete-with-undo.

### 5.1 New files
```
apps/web/src/app/(producer)/dashboard/store/
├── page.tsx                          # server component, fetches products + producer profile
├── store-screen.tsx                  # client, composes the catalog
├── store-header.tsx                  # eyebrow + Store. wordmark + counts line
├── store-toolbar.tsx                 # filter tabs + search + view toggle
├── product-card.tsx                  # row card with type tile + name + tagline + price + actions
├── type-tile.tsx                     # gradient tile with Lucide icon, sizes 32 and 60
├── kind-to-tile.ts                   # the §4 mapping
├── new-product-button.tsx            # amber CTA with N keyboard hint
├── empty-state.tsx                   # dashed-border empty card
└── __tests__/
    ├── kind-to-tile.test.ts
    ├── type-tile.test.tsx
    ├── product-card.test.tsx
    ├── store-toolbar.test.tsx
    └── store-screen.test.tsx

apps/web/src/app/(producer)/dashboard/portfolio/
├── page.tsx                          # mounts existing PortfolioPanel
├── portfolio-panel.tsx               # MOVED from /dashboard/profile/
└── actions.ts                        # MOVED from /dashboard/profile/
```

### 5.2 Files updated
| File | Change |
|---|---|
| `producer-sidebar.tsx` | `Store` href to `/dashboard/store`. Append `Portfolio` item. |
| `producer-bottom-nav.tsx` | Same. |
| `app/(producer)/dashboard/profile/page.tsx` | Replace with redirect. |
| `app/(producer)/dashboard/profile/portfolio-panel.tsx`, `actions.ts` | DELETE (moved to /portfolio). |
| `app/(producer)/dashboard/profile/storefront-screen.tsx` reference | Removed when redirect lands. |
| `components/dashboard/storefront/storefront-screen.tsx` + its test | DELETE. Replaced by `app/(producer)/dashboard/store/store-screen.tsx` and a new co-located test. |

### 5.3 Behavior parity carryover
All three server actions stay: `setPackageActive`, `duplicatePackage`, `archivePackage`. Toggle still calls `setPackageActive`. Edit Modal still mounts `NewPackageForm` (Phase 1 only). Toast tone matches design: success on publish, default on hide, success on duplicate.

### 5.4 New components, behavior
- **`<TypeTile type size>`**: 32 and 60 variants. Gradient backgrounds with inset shadows and radial highlight. Renders Lucide icon centered, white, stroke 2.2. When `hidden` prop is true, applies translucent overlay with `eye-off`.
- **`<SegmentedTabs items value onChange>`**: All / Live / Hidden with count badge per tab.
- **`<ViewToggle value onChange>`**: Cards / Table. In Phase 1, Table option renders disabled with a `Coming soon` tooltip.
- **`<Toggle on onChange>`**: 44×24 switch, springy thumb (`cubic-bezier(.34,1.56,.64,1)` 220ms). Replaces the inline-button toggle from the current cards.
- **`<ProductCard>`**: full-width row, drag handle visual, `<TypeTile>`, name + tagline (line-clamp:1 of `description`), price (Syne 800 26px), `<Toggle>`, ghost Edit, icon-button Delete. Hover lift, accent stripe in tile color.

### 5.5 Filter, search, hidden divider
Client-side state in `<StoreScreen>`:
```ts
type FilterTab = "all" | "live" | "hidden";
type ViewMode = "cards" | "table";
const [filter, setFilter] = useState<FilterTab>("all");
const [search, setSearch] = useState("");
const [view, setView] = useState<ViewMode>("cards");
```
Counts derive from raw `products`. Filtered list: `filter` first, then case-insensitive substring search on `name + description`. When `filter === "all"`, render a `HIDDEN · N` divider above hidden items.

### 5.6 Keyboard shortcuts (in Phase 1, not Phase 3)
- `/` focuses search input. Hint chip on the input.
- `N` opens new-product flow (Phase 1: opens existing `NewPackageForm`). Hint chip on the button.
- `Esc` closes any open modal.
- `Enter` on a focused card opens the editor.
- Visual focus rings on every interactive element (existing `sk-press` + `focus-visible:ring-2`).

### 5.7 Animations in Phase 1
- Page reveal-up on mount (existing keyframe).
- Card hover lift 220ms.
- Toggle thumb spring 220ms.
- Toast slide-in 220ms (existing).
- `prefers-reduced-motion: reduce` honored by existing `tokens.css`.

Deferred to Phase 3: livePulse on Live status, shimmer-glow on new products, drag opacity/scale, drop-above/below indicators.

## 6. Phase 2, Editor + Delete-with-Undo

**Goal:** match the handoff's Editor design exactly. Replace `NewPackageForm` mounting on this page.

### 6.1 New files
```
apps/web/src/app/(producer)/dashboard/store/
├── product-editor.tsx                # the centered Editor modal
├── type-preset-picker.tsx            # 4-card preset grid (Production / Mix / Master / Blank)
├── type-presets.ts                   # ported TYPE_PRESETS data from prototype
├── editor-tabs/
│   ├── basics-tab.tsx
│   ├── pricing-tab.tsx
│   ├── inclusions-tab.tsx
│   └── logistics-tab.tsx
├── delete-confirm-modal.tsx          # 420px portaled confirm modal
└── __tests__/...
```

### 6.2 Form-to-schema mapping
| Editor field | DB column |
|---|---|
| Name | `products.name` |
| Tagline (free text) | `products.description` (first line shows on card) |
| Type | `products.kind` (set from preset picker) |
| Price + currency | `products.priceCents` + `products.currency` |
| Deposit % | `products.depositPct` |
| Duration | `products.durationMin` |
| Sessions count | `products.sessionCount` |
| Unlimited sessions | `products.sessionCount === 0` (sentinel) |
| Payment plan | `products.paymentPlans` (existing JSON shape) |
| Inclusions checklist | `products.deliverables` (existing text array) |
| Revisions, turnaround | NOT in schema. Encoded into `description` as structured prefix `Revisions: 2 | Turnaround: 5 days | <free text>` for Phase 2. Phase 4+ may add columns. |

### 6.3 Delete with Undo
- Replace Archive menu item with Delete (×) button on the card.
- Click opens `<DeleteConfirmModal>` (portaled to `document.body`).
- On Confirm, optimistically remove from list, call `archivePackage` server action, show toast with `Undo` action.
- Undo re-activates by calling a new `restorePackage` action that nulls `archivedAt` and sets `active=false` (returns hidden, not live, so the producer reviews before relisting).

### 6.4 Animations in Phase 2
- popIn on Editor modal (240ms, scale 0.97 to 1, translateY 12 to 0, opacity 0 to 1).
- Confirm modal popIn same curve.
- Toast already animates.

## 7. Phase 3, Drag, Table, Polish

**Goal:** match the handoff completely.

### 7.1 New files
```
apps/web/src/app/(producer)/dashboard/store/
├── product-row.tsx                   # table row (5-column grid)
├── store-table.tsx                   # table view container
├── use-drag-reorder.ts               # native HTML5 DnD hook
└── __tests__/...
```

### 7.2 New server action
`reorderProducts(orderedIds: string[])`. Updates `products.position` in a single transaction. Idempotent.

### 7.3 Table view
5-column grid `minmax(0,1fr) 140px 110px 80px 130px`. Group dividers `LIVE` / `HIDDEN` when filter is `all`. Row-level hover, click anywhere to open editor. Type chip per row in tile gradient.

### 7.4 Animations in Phase 3
- Drag state: source opacity 0.4 + scale(0.98).
- Drop indicators: 3px brand-color line on top or bottom edge.
- New-product shimmer-glow: 2 iterations of 2s.
- Live status pill: 2.2s breathing pulse on the dot.
- Row entry: 320ms staggered fade+slide for table.

## 8. Adaptations from handoff

Three deltas Gili approved on 2026-05-10:

1. **"Delete" UX, soft-delete data.** The button labels match handoff (`Delete`, `Delete product`, `Undo`). Data stays via `archivedAt` so historical bookings still resolve. After 4.5s the row is unrecoverable from the producer's view, but the row exists in the DB indefinitely.

2. **Tagline source.** No `tagline` column. Card renders `description.split('\n')[0]` with `line-clamp:1`. Editor binds to the full `description` field.

3. **Featured chip removed.** No `featured` UI on the new card. Schema field stays untouched.

## 9. Testing strategy

Test-driven. Each component lands as red, then green, then refactor. Tests are co-located in `__tests__/` next to the component.

### 9.1 Test types per component
| Component | Test focus |
|---|---|
| `kind-to-tile.ts` | Pure mapping function. Every documented `kind` value to its tile, plus fallback to consult. |
| `<TypeTile>` | Renders correct gradient and icon by type. `hidden` prop applies overlay. Both 32 and 60 sizes render at correct dimensions. |
| `<SegmentedTabs>` | Tab click fires `onChange` with the right tab id. Count badge renders. Active tab has correct ARIA. |
| `<Toggle>` | Click toggles. ARIA `aria-pressed` flips. Keyboard `Space` and `Enter` toggle. |
| `<ProductCard>` | Renders name, tagline (first line of description), price (formatted by currency). Toggle calls handler. Edit button opens editor. Delete button opens confirm (Phase 2) or archive flow (Phase 1). Card-click bubbles unless action area. Hidden state applies opacity. |
| `<StoreScreen>` | Filter tab changes filter state. Search input filters list. Counts on tabs reflect filtered data. Empty state when filtered list is empty. Hidden divider appears on `all` filter. Keyboard `/` focuses search. Keyboard `N` opens new flow. |
| `kind-to-tile` source-grep regression | Pin that the new screen does not link to `/dashboard/settings?section=services` (carries forward the existing 2026-05-06 regression test). |

### 9.2 Verification gates per phase
Before any push, run `pnpm typecheck && pnpm lint && pnpm test`. Per the project memory `feedback_run_lint_not_just_typecheck.md`, lint is non-optional. Per `feedback_skitza_sw_cache_on_deploy.md`, verify deploy in incognito.

## 10. Out of scope

These are intentionally not in any of the 3 phases:
- Schema migrations (no new columns added). `Revisions` and `turnaround` fields on the editor get serialized into `description` for Phase 2 to avoid blocking on Raz's schema work.
- Analytics aggregation (page stats card is dropped, not deferred).
- Public live-page preview card (dropped per Q4).
- Featured products UI (dropped, data preserved).
- Currency limited to handoff's USD/ILS/EUR (we keep all four: USD, EUR, GBP, ILS).
- Bottom-nav redesign beyond the new Portfolio entry.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Old `/dashboard/profile` URL exists in marketing emails or external links | 308 redirect on the route. Keep redirect indefinitely. |
| Producers with `kind=hourly` or `kind=beat_lease` get the slate "Consult" tile, which feels off | The mapping lives in one helper. We can add a 5th tile later in one PR if it bothers anyone. Visual remains coherent in the meantime. |
| Existing `NewPackageForm` is large and tightly coupled to the booking flow | Phase 1 keeps it untouched. Phase 2 builds the new Editor as a sibling component, NewPackageForm gets removed only after the new Editor reaches feature parity, behind a feature flag if necessary. |
| Drag-reorder requires DB writes that could race with toggles | Phase 3 only. `reorderProducts` is a single transaction. Optimistic UI reverts on server error. |
| The 30k-line existing `storefront-screen.tsx` getting deleted in Phase 1 may break some import elsewhere | Pre-delete grep across the repo. Confirm no other surface imports it. The Phase 1 PR includes the cleanup. |
| Service worker may cache stale UI after deploy | Per the project memory, verify in Incognito after each phase ships to skitza.app. |

## 12. Order of operations

1. Approve this brief (DONE, in chat 2026-05-10).
2. Commit this brief on `v3-clean`. (NEXT)
3. Branch `phase-1-store-redesign` off `v3-clean`.
4. Run `superpowers:writing-plans` to convert this brief into a numbered, test-first implementation plan.
5. Execute Phase 1 plan task-by-task, committing each green test plus its implementation.
6. Open Phase 1 PR against `v3-clean`. Verify in Incognito after merge.
7. Repeat for Phase 2, then Phase 3.
