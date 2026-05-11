# Session Recap — Producer Storefront Redesign

> **For the next Claude session:** READ THIS FIRST. The work is mid-stream. The branch `phase-1-store-redesign` is pushed to origin with 44 commits ahead of `origin/v3-clean`. Vercel preview is live. Phase 1 + Phase 2 are done. Phase 3 is the remaining "nice to have" work. The user is the one approving each merge — do not open the PR without a "ship it".

**Last updated:** 2026-05-11
**Branch:** `phase-1-store-redesign` (pushed to origin)
**Last commit:** `383e801` — `feat(store): add Logistics step + 3-mode Agreement (file/link/text)`
**Vercel preview:** https://skitza-v2-web-git-phase-1-store-redesign-gili-asrafs-projects.vercel.app/dashboard/store
**Status:** Pipeline green (typecheck + lint + 1529 tests + build). Waiting on Gili to approve PR.

---

## TL;DR

We redesigned the producer Store page from a 2-column tabbed `/dashboard/profile` into a single-column `/dashboard/store` that matches the design handoff at `/Volumes/KINGSTON/Downloads/design_handoff_storefront/`. Portfolio split off to its own page `/dashboard/portfolio`. New product Editor is a 5-step wizard (Type → Includes → Pricing → Logistics → Agreement). Delete uses a portaled confirm modal with a 4.5s Undo toast. Zero `window.confirm` left in the flow. Existing data layer (tRPC + Drizzle) untouched except for one new `restore` mutation.

## Design and plan documents (source of truth)

| File | Purpose |
|---|---|
| [`docs/plans/active/2026-05-10-storefront-redesign-design.md`](plans/active/2026-05-10-storefront-redesign-design.md) | Design brief: scope, phasing, type-tile mapping, three adaptations from handoff, routing, risks. Approved by Gili 2026-05-10. |
| [`docs/plans/active/2026-05-10-storefront-redesign-phase-1.md`](plans/active/2026-05-10-storefront-redesign-phase-1.md) | Phase 1 plan: 21 bite-sized TDD tasks. Executed via subagent-driven development. All shipped on branch. |
| [`docs/plans/active/2026-05-11-storefront-redesign-phase-2.md`](plans/active/2026-05-11-storefront-redesign-phase-2.md) | Phase 2 plan: editor wizard, delete-with-undo, removes `window.confirm`. Pre-flight section documents the schema/tRPC reality. All shipped on branch with later iteration on top. |
| `/Volumes/KINGSTON/Downloads/design_handoff_storefront/` | The handoff itself: `README.md`, `storefront.html` (high-fi React prototype), `styles/tokens.css`. The HTML is the authoritative reference. |

## What's done (on branch, deployed)

### Phase 1, visual shell
- `/dashboard/store` page with full new visual (Syne `Store.` wordmark, type tiles, filter tabs, search, cards)
- Type tile mapping (4 types: mix/master/production/consult) auto-mapped from existing `kind` values in `apps/web/src/app/(producer)/dashboard/store/kind-to-tile.ts`
- 12 small components in `apps/web/src/app/(producer)/dashboard/store/` (StoreHeader, StoreToolbar, ProductCard, etc.)
- Keyboard shortcuts (`/`, `N`, `Esc`)
- `/dashboard/portfolio` (Portfolio content moved here, untouched)
- `/dashboard/profile` is a 308 redirect (handles `?tab=portfolio` too)
- Sidebar + bottom-nav updated with `Store` + `Portfolio` as siblings
- Old `/components/dashboard/storefront/storefront-screen.tsx` and its test deleted (898 lines)

### Phase 2, editor wizard + delete-with-undo
- New 5-step editor wizard: Type preset picker → Includes (name + chips) → Pricing & terms → Logistics → Agreement
- New 4-step edit wizard (same but skips Type)
- `<TypeStep>`, `<IncludesStep>`, `<PricingStep>`, `<LogisticsStep>`, `<ContractStep>`, `<EditorShell>`, `<StepBar>` (in `editor-steps/` + top-level)
- TYPE_PRESETS data ported verbatim from prototype (`type-presets.ts`)
- `<DeleteConfirmModal>` (portaled to body, red icon block, 420px max-w)
- `useUndoableDelete` hook with 4.5s Undo toast via Sonner
- `useToast()` extended to accept `{ durationMs, action }` (backwards-compatible third arg)
- New `restorePackage` server action + new tRPC `booking.packages.restore` mutation
- `window.confirm` removed from `<StoreScreen>` entirely
- `<NewPackageForm>` no longer mounts on the Store page

### Phase 2 polish (post-review iteration)
- Fixed transparent modal: replaced non-existent CSS tokens (`--surface-card`, `--text-muted`, `--text-strong`, `--surface-hover`, `--brand-primary-on`) with Skitza's real ones (`--bg-elevated`, `--fg-muted`, `--fg-default`, `--bg-sidebar`, plus the literal `rgb(17_16_9/0.06)` for hover).
- Fixed modal "opens top-left then snaps to center": browsers don't scope `@keyframes` by media query, so the second `popIn` definition inside `@media (max-width: 639px)` was globally shadowing the centered version. Now: centering transform on `Dialog.Content`, scale/fade animation on an inner wrapper div. Single keyframe.
- Tightened `<PricingStep>` spacing and added the `Infinity` button next to Sessions.
- Wordmark sized down from `clamp(56, 14vw, 120)` to `clamp(42, 8.5vw, 88)` so it doesn't dominate a sparse catalog inside the producer app shell.
- Sidebar `portfolio` translation key added to `apps/web/messages/en.json` (was rendering as `sidebar.portfolio`).

### Phase 2 v2 (logistics + 3-mode agreement)
- New `<LogisticsStep>`: Duration free-text input + Revisions optional stepper (0–20)
- `<ContractStep>` rebuilt with 3 modes (File / Link / Text); File mode shows dropzone + a "PDF upload coming soon" hint with a URL fallback
- `description-encoding.ts` restored (with a new format: `revisions` + `contract_text`) to round-trip those fields through `products.description` until a future schema migration
- `<ProductEditor>` wizard updated to 5 steps for new, 4 for edit

## What's NOT done

### Phase 3 (originally planned, not started)
- Drag-to-reorder products (uses existing `products.position` column)
- Functional Table view (toggle exists but option is disabled with "Coming soon" tooltip)
- Animation polish: live-pulse on Live status pill, new-glow on duplicate/create
- The full plan for Phase 3 is sketched in the design brief but no separate task plan written yet.

### Future tech debt
- **PDF file upload pipeline.** File mode in Agreement currently behaves like Link mode (paste URL into the same input). Real PDF upload needs an R2 endpoint or similar.
- **Schema migration**: `revisions` + `contract_text` currently encoded into the `products.description` column via a `\n---\n` separator. Card-side `deriveTagline` takes `description.split('\n')[0]` so the meta block doesn't leak, but dedicated columns would be cleaner. Raz's domain.
- **`StoreProduct` interface review**: A future cleanup could shed unused fields (e.g. `bufferMinutes`, `minLeadHours`, `locationType`, `paymentPlans`) from the row shape if the new editor truly doesn't need them. Currently we pass them through for round-trip safety.

### To ship Phase 1 + 2 to production
1. Gili reviews the latest Vercel preview.
2. On approval, open the PR:
   ```bash
   gh pr create --base v3-clean \
     --title "feat(store): producer storefront redesign, Phase 1 + 2" \
     --body "$(cat <<'EOF'
   ## Summary
   - Replaces /dashboard/profile with new design at /dashboard/store
   - Portfolio moved to /dashboard/portfolio
   - 5-step editor wizard with type presets
   - Delete with 4.5s Undo
   - Zero window.confirm

   Design brief: docs/plans/active/2026-05-10-storefront-redesign-design.md
   Phase 1 plan: docs/plans/active/2026-05-10-storefront-redesign-phase-1.md
   Phase 2 plan: docs/plans/active/2026-05-11-storefront-redesign-phase-2.md
   Recap: docs/session_recap.md

   ## Test plan
   - [ ] /dashboard/store renders with type tiles, filter, search
   - [ ] / and N keyboard shortcuts focus the search + open new-product
   - [ ] /dashboard/profile redirects (Incognito to bypass SW cache)
   - [ ] /dashboard/portfolio still shows tracks + external links
   - [ ] New product wizard: Type → Includes → Pricing → Logistics → Agreement
   - [ ] Delete shows portaled confirm modal, NOT window.confirm
   - [ ] Undo toast restores within 4.5s as Hidden
   - [ ] Sidebar shows Store + Portfolio entries

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```
3. Vercel preview deploy URL persists on the PR. Merge when CI is green.

## Decisions log (chronological)

1. **Q1 Scope** — option B: replace whole page, move Portfolio to `/dashboard/portfolio`, redirect old `/dashboard/profile`.
2. **Q2 Phasing** — option B: 3 phases (visual shell → editor + delete-with-undo → drag + table + animations). Same total scope as big-bang.
3. **Q3 Type mapping** — option A: auto-map existing `kind` values to the 4 design tiles (mix/master/production/consult). Anything that doesn't fit (session, custom, hourly, beat_lease) → consult tile. Mapping lives in one helper for easy re-tuning.
4. **Q4 Drop everything not store-related** — no "View live page" affordance, no preview card, no stats panel. Page is laser-focused on the catalog.
5. **3 small adaptations from handoff**:
   - "Delete" UX but soft-delete data via `archivedAt` (preserves booking history). Producer never sees the deleted row again. Undo for 4.5s.
   - Tagline = `description.split('\n')[0]` (first line of description, single-line clamp). No new column.
   - Featured chip dropped from card UI (data column kept).
6. **No `window.confirm` anywhere** — explicit Gili call. Phase 2's `<DeleteConfirmModal>` replaces it.
7. **Editor wizard simplification after review** — first iteration of Pricing had Deposit / Duration / Revisions / Turnaround all on the same step. Gili compared to the reference and asked to drop them. Then later asked to bring Duration + Revisions back in a new "Logistics" step. Final scope: Pricing has only Price + Sessions + How Artists Pay. Logistics has Duration + Revisions.
8. **Agreement step 3 modes** — File (dropzone + URL fallback because no upload pipeline yet), Link (URL), Text (textarea). Text terms saved into description meta block.

## Branch state details

```
phase-1-store-redesign
├── 44 commits ahead of origin/v3-clean
├── Includes:
│   ├── 2 docs commits (design brief + Phase 1 plan)
│   ├── 1 docs commit (Phase 2 plan)
│   ├── 22 Phase 1 implementation commits
│   ├── 14 Phase 2 implementation commits
│   ├── 1 sidebar test-fixture fix
│   ├── 1 lint fix (saved-day-name typo) + 1 lint fix (description-encoding committed file)
│   ├── 1 modal bg + animation fix
│   └── 1 logistics + 3-mode agreement commit
```

## How to resume in a new session

1. **Read this recap first.** It points to everything.
2. **Confirm branch** — `git rev-parse --abbrev-ref HEAD` should report `phase-1-store-redesign`. If on `v3-clean`, run `git checkout phase-1-store-redesign`.
3. **Confirm pipeline** — `pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test` should be green.
4. **Ask Gili what's next.** Options on the table: (a) ship Phase 1+2 by opening the PR, (b) start Phase 3 in this branch, (c) fix anything still flagged on the preview.

## Token reality check (carry this forward)

The Skitza app uses ONLY these CSS custom properties:

```
--brand-primary       (212 150 10 — amber)
--brand-primary-dark  (where defined, optional)
--bg-background       (242 237 230 — warm off-white page bg)
--bg-elevated         (255 255 255 — white, USE FOR MODAL/CARD BG)
--bg-sidebar          (17 16 9 — near-black; dark surface AND dark text on amber)
--fg-default          (17 16 9 — body text, USE INSTEAD OF --text-strong)
--fg-muted            (107 99 89 — secondary text, USE INSTEAD OF --text-muted)
--fg-faint            (165 158 145 — placeholder/empty)
--fg-success          (30 120 70 — toggle on, success toast)
--fg-danger           (192 50 38 — destructive actions)
--fg-warning          (176 104 48)
--border-subtle       (232 225 212)
--border-strong       (200 192 178)
```

**These tokens DO NOT EXIST** and will resolve to nothing (causing transparent backgrounds, invisible text):

```
--surface-card        ❌ — use --bg-elevated
--surface-hover       ❌ — use literal rgb(17_16_9/0.06)
--text-muted          ❌ — use --fg-muted
--text-strong         ❌ — use --fg-default
--brand-primary-on    ❌ — use --bg-sidebar for dark text on amber
```

When in doubt, grep `apps/web/src/styles/tokens.css` for the canonical list. Phase 2's initial EditorShell shipped with the wrong tokens (copied from the prototype's `styles/tokens.css` which uses a different naming scheme), making the modal transparent — an avoidable mistake.

## Testing convention (carry forward)

Vitest runs in `node` env with NO jsdom and NO `@testing-library/react`. Two test patterns:

1. **Pure-function unit tests**: standard `expect(...)` on helpers (e.g. `kind-to-tile.test.ts`, `filter-search.test.ts`).
2. **Source-grep tests on JSX shells**: `readFileSync` the `.tsx` file, assert it contains key imports / class names / attributes (e.g. `type-tile.test.tsx`, `product-editor.test.tsx`). Mirror the pattern in `apps/web/src/components/dashboard/today/__tests__/pulse-card.test.tsx`.

No DOM interactions. Behavior is exercised by real consumers + manual preview verification.

## Vercel preview cache gotcha (from project memory)

The skitza.app service worker can cache stale UI on the user's normal browser. Always verify post-deploy in **Incognito**. The branch alias URL stays the same across pushes, so the same Incognito tab refreshes against the latest deploy automatically.
