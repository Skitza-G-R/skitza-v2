# Session Recap — Clients & Projects v3 Redesign

> **For the next Claude session:** READ THIS FIRST. Phase 1 is in PR #117 with the G1-G5 punch list applied. Awaiting Gili's manual Incognito QA before merge. Phase 0 already merged.

**Last updated:** 2026-05-15
**Branch:** `clients-projects-phase-1` (pushed to origin; worktree at `/Users/giliasraf/skitza-phase-1`)
**PR:** [#117](https://github.com/Skitza-G-R/skitza-v2/pull/117) — Phase 1 redesign (big-bang list + Client Space + invite + drag)
**Status:** All gates green (typecheck clean, lint zero warnings, 1780 tests passing). Manual Incognito QA against the 12-item PR checklist is the last step before merge.

---

## TL;DR

5-phase faithful port of the Clients Projects Room prototype into the producer app. New IA: List → Client Space → Album Page → Song Space, with a Single-Space rule. Phase 0 (schema) is **merged**; Phase 1 (list view + Client Space + invite flow + drag) is in **PR #117** awaiting QA. Reuses the existing PersistentPlayer — no new audio infrastructure. TDD throughout.

## Design and plan documents (source of truth)

| File | Purpose |
|---|---|
| [`docs/plans/active/2026-05-14-clients-projects-redesign-design.md`](plans/active/2026-05-14-clients-projects-redesign-design.md) | Master design brief. Approved by Gili 2026-05-14. |
| [`docs/plans/active/2026-05-14-clients-projects-redesign-phase-1.md`](plans/active/2026-05-14-clients-projects-redesign-phase-1.md) | Original Phase 1 plan (Tasks 1-20). Executed 2026-05-14. |
| [`docs/plans/active/2026-05-15-clients-projects-phase-1-punch-list.md`](plans/active/2026-05-15-clients-projects-phase-1-punch-list.md) | Punch list (G1-G5) from the 2026-05-15 audit. Executed 2026-05-15. |
| `/Volumes/KINGSTON/Downloads/Clients Projects Room.html` | The HTML prototype — source of truth for visuals. |
| `/Volumes/KINGSTON/Downloads/DESIGN.md` | Design tokens + component spec. |
| `/Volumes/KINGSTON/Downloads/BUILD-NOTES.md` | Engineering handoff with data shapes + routing rules. |

## Phase status

| Phase | Status | PR | Ship to |
|---|---|---|---|
| 0 — Schema migrations | ✅ Merged | [#113](https://github.com/Skitza-G-R/skitza-v2/pull/113) | v3-clean |
| 1 — List view + Client Space + invite + drag | 🟡 In review | [#117](https://github.com/Skitza-G-R/skitza-v2/pull/117) | v3-clean |
| 2 — Album Page (replaces Project Room) | Planned | — | v3-clean |
| 3 — Song Space + Single-Space rule | Planned | — | v3-clean |
| 4 — Upload Track modal + manual stage edit | Planned | — | v3-clean |
| 5 (opt) — PersistentPlayer visual polish | Planned | — | v3-clean |

## What's on PR #117

### Original Phase 1 (Tasks 1-20, executed 2026-05-14)

- Helpers: `deriveGradient` (name → 1-of-6 token), `heroBg` (token → dark hero CSS)
- Atoms: `LinkPill`, `StatTile`, `HeroCTA`
- Rows: `ProjectRow`, `ClientCard`
- Composed surfaces: `ClientSpaceHero`, `WorkspaceListView`
- `InviteToAppModal` (email via Resend + copy-link via clipboard)
- tRPC mutations: `clientContacts.sendInvite`, `clientContacts.reorder`, `projects.reorder`
- Two `page.tsx` files rebuilt (`/clients-projects` and `/clients-projects/clients/[id]`)
- 13 obsolete files deleted (old 4-tab Client Space + old list components)
- 17 new test files
- Three C1/C2/I1 fixes (sort dropdown / drag persistence / dead code) applied after initial review

### Punch-list fixes (executed 2026-05-15, this session — 8 commits)

| Commit | What |
|---|---|
| `b55caf2` | Deleted `seed-clients-projects-demo.mjs` (no longer needed) |
| `03fc2d0` | **G3** — Project filter chip "Urgent" → "Needs attention" |
| `6513f66` | **G2** — Clients tab first + default |
| `cb1ca0d` | **G4** — Hide cards/table layout switcher on Projects tab |
| `ccd3bb3` | **G1** — Page header with tab-aware "New client" / "New project" CTA |
| `d5f0fa4` | Polish: `&amp;` sibling convention + whitespace-tolerant tab test |
| `308ef58` | **G5** — Status pill labeled in title block + plain chevron column 8 |
| `7fa0596` | Polish: drop redundant chevron aria-label + stale comment |

## What still needs to happen for Phase 1 to merge

1. **Manual Incognito QA** against the 12-item checklist in the PR body. Memory: skitza.app has a service worker that caches stale UI — verify in Incognito, not hard-refresh. Vercel preview URLs are SSO-gated, so open the PR's "Ready" link directly.
2. On QA pass: merge PR #117 into v3-clean. Vercel deploy hook ships the new UI.
3. **Migration 0011 from Phase 0 must be applied to prod before merge** if not already done. Use `node packages/db/apply-migrations.mjs` with the unpooled Neon URL (drizzle-kit migrate is broken — journal stops at 0018).
4. Start Phase 2 (Album Page) on a fresh branch off v3-clean.

## Decisions baked into Phase 1 (do not re-litigate)

Resolved during the 2026-05-15 punch-list session:

1. **Clients tab is first + default** (G2). Matches DESIGN.md §4.1 + BUILD-NOTES §10. New IA has clients OWN projects.
2. **Layout switcher hidden on Projects tab** (G4). Real table mode with sortable headers deferred to fast-follow.
3. **"+ New client" CTA routes to `/clients-projects/new?clientFirst=1`** for v1 — no modal yet. A dedicated New Client modal is captured as a Phase 1.5 fast-follow.
4. **No URL hydration for `?tab=` / `?sort=` / `?filter=`.** WorkspaceListView owns state locally for v1.

Carried over from 2026-05-14:

5. Full faithful port (replace current Project Room IA, add Song Space, add Single-Space rule).
6. Gili authorized Claude to write the schema migrations directly for this redesign (Raz reviews PR before merge).
7. Drop the Notes tab entirely. `projects.notes` column stays in DB but no UI exposes it.
8. Add new `workflow_stage` column rather than replace the legacy `stage` enum. Old `stage` keeps running billing.
9. 5-stage workflow: Brief → Production → Mixing → Mastering → Done (Gili dropped Review and Delivery vs the prototype's 6).
10. Reuse existing `PersistentPlayer`. No new audio infrastructure.

## Open follow-ups (NOT in Phase 1 — picked up later)

- Real table mode for Projects (sortable column headers per BUILD-NOTES §5.1)
- Dedicated "New Client" modal
- URL hydration (`?tab=`, `?sort=`, `?filter=`)
- Drag accessibility (keyboard arrow navigation)
- PersistentPlayer visual polish (optional Phase 5)
- Reconcile `pill-warn`/`pill-ok` class names with `globals.css`'s `pill-warning`/`pill-success` — pre-existing mismatch surfaced during G5 review

## How to resume in a new session

1. Read this recap first. It points to everything.
2. Read the master design brief: `docs/plans/active/2026-05-14-clients-projects-redesign-design.md`.
3. Confirm branch state: `git rev-parse --abbrev-ref HEAD` should be `clients-projects-phase-1` until PR #117 merges. After merge, switch to v3-clean and start Phase 2 on a fresh branch.
4. Confirm pipeline: `pnpm typecheck && pnpm -F web lint && pnpm test` — all green.
5. Ask Gili what's next.

## Token reality check (carry forward)

The Skitza app uses ONLY these CSS custom properties:

```
--brand-primary       (212 150 10 — amber)
--bg-background       (242 237 230 — warm off-white page bg)
--bg-elevated         (255 255 255 — white, USE FOR MODAL/CARD BG)
--bg-sidebar          (17 16 9 — near-black; dark surface AND dark text on amber)
--fg-default          (17 16 9 — body text, USE INSTEAD OF --text-strong)
--fg-muted            (107 99 89 — secondary text, USE INSTEAD OF --text-muted)
--fg-faint            (165 158 145 — placeholder/empty)
--fg-success / --fg-danger / --fg-warning
--border-subtle / --border-strong
```

**Forbidden (do not exist):** `--surface-card`, `--surface-hover`, `--text-muted`, `--text-strong`, `--brand-primary-on`. Using them = invisible text + transparent backgrounds. Always grep `apps/web/src/styles/tokens.css` for the canonical list when in doubt.

`--bg-base` and `--fg-primary` are **backward-compat aliases** that resolve through CSS `var()` recursion to `--bg-background` and `--fg-default` respectively. Both forms work, but new code prefers the canonical names.

## Testing convention (carry forward)

Vitest in `node` env, no jsdom, no `@testing-library/react`. Two patterns:

1. **Pure-function unit tests** — standard `expect(...)` on helpers.
2. **Source-grep tests on JSX shells** — `readFileSync` the `.tsx` file, assert it contains key imports / class names / attributes. **Use `\s*` in regexes** to stay whitespace-tolerant against `prettier --write` (lesson learned from the Phase 1 polish commit).

No DOM interactions. Behavior is exercised by real consumers + manual preview verification.

## Auxiliary stashes (recoverable)

- `stash@{0}: On clients-projects-redesign: pre-clients-projects-redesign: dashboard simplification WIP` — 4 files (page.tsx, page-helpers.ts, page-rebuild.test.ts, empty-onboarding.tsx). Landed on `fix/dashboard-overview-after-onboarding` instead. Gili can `git stash drop`.
