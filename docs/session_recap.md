# Session Recap

## Active branches and PRs

| Branch | PR | Subject | Status |
|---|---|---|---|
| `settings-redesign` | [#116](https://github.com/Skitza-G-R/skitza-v2/pull/116) | feat(settings): 5-section sub-nav with savebar | Pipeline green, schema migration 0012 pending apply |
| `clients-projects-redesign` | [#113](https://github.com/Skitza-G-R/skitza-v2/pull/113) | Phase 0 (schema) | Pipeline green, waiting on Raz review |
| `overview-first-week-empty` | — | Overview first-week empty state (predicate landed) | 1 commit ahead of `v3-clean`, pushed to origin |

---

## Settings redesign (2026-05-14, branch `settings-redesign`, PR #116)

Replaced the 2-branch chip surface with the design's 5-section sub-nav layout from `/Volumes/KINGSTON/Downloads/scratch/settings-handoff/`. Five live sections (Profile · Plan & billing · Notifications · Integrations · Language & region). Studio is intentionally deferred — schema columns (business name, city, country, tax ID) don't exist yet.

**Schema added (migration 0012):**
- `producers.plan` text NOT NULL DEFAULT 'free'
- `producers.week_start` text NOT NULL DEFAULT 'sun'
- `producers.notification_prefs` jsonb NOT NULL DEFAULT '{}'

**Removed from Settings UI** (data stays in DB, future `/dashboard/public-page` route picks them up): slug, brand colors, logo, portfolio image picks, marketing copy (genres/response/streams), Autopilot toggles, data-export button, replay-tour button.

**Plan & Notifications are UI-only:** Plan reads `producers.plan` and renders fake free/pro hero + usage. CTAs toast "Coming soon." Notifications saves the 6-event × 2-channel matrix but the actual email/in-app delivery wiring lands feature-by-feature.

**Payments unified:** one "Payments" row covers both Tranzila (Israel) and Stripe (rest of world). The existing PaymentCard + StripeCard render below the integrations card for actual connect flows.

**Files:** `apps/web/src/app/(producer)/dashboard/settings/{page,settings-client,settings-keys,settings.css}.{tsx,ts,css}` + migration `packages/db/drizzle/0012_settings_redesign.sql`. Old `settings-form.tsx` deleted. `settings-cleanup.test.ts` rewritten.

**After merge:** Gili runs `DATABASE_URL=… node packages/db/apply-migrations.mjs` to apply 0012.

---

# Earlier: Clients & Projects v3 Redesign

> **For the next Claude session:** READ THIS FIRST. The work is mid-stream. Branch `clients-projects-redesign` is pushed to origin with 10 commits ahead of `origin/v3-clean`. PR #113 is open and **waiting on Raz's review** of the schema. Phase 0 is complete; Phases 1-4 are planned but not yet implemented.

**Last updated:** 2026-05-14
**Branch:** `clients-projects-redesign` (pushed to origin)
**Last commit:** `ed32a5e` — `feat(db): SQL migration 0011 for Clients & Projects v3`
**PR:** [#113](https://github.com/Skitza-G-R/skitza-v2/pull/113) — Phase 0 (schema)
**Status:** Pipeline green (typecheck + lint + 1617 tests). Waiting on Raz to review the migration.

---

## TL;DR

Started a 5-phase faithful port of the Clients Projects Room prototype into the producer app. New IA: List → Client Space → Album Page → Song Space, with a Single-Space rule that collapses 1-song projects directly into the Song Space. Phase 0 (schema migrations) is in PR #113; subsequent phases will replace the current 5-sub-tab Project Room with the new structure. **Reuses the existing PersistentPlayer** — no new audio infrastructure. TDD throughout; extra-cautious execution per Gili's brief.

## Design and plan documents (source of truth)

| File | Purpose |
|---|---|
| [`docs/plans/active/2026-05-14-clients-projects-redesign-design.md`](plans/active/2026-05-14-clients-projects-redesign-design.md) | Master design brief. Decisions log, routing/IA, schema, components, the 4 modals, phasing, testing strategy, safety rules. Approved by Gili 2026-05-14. |
| [`docs/plans/active/2026-05-14-clients-projects-redesign-phase-0.md`](plans/active/2026-05-14-clients-projects-redesign-phase-0.md) | Phase 0 plan: 12 bite-sized TDD tasks for the schema migrations. Executed via subagent-driven development. All shipped on branch. |
| `/Volumes/KINGSTON/Downloads/Clients Projects Room.html` | The HTML prototype — source of truth for visuals when the design doc is ambiguous. |
| `/Volumes/KINGSTON/Downloads/DESIGN.md` | Design tokens + component spec from the prototype. |
| `/Volumes/KINGSTON/Downloads/BUILD-NOTES.md` | Engineering handoff with data shapes + routing rules. |

## What's done (on branch, awaiting Raz)

### Phase 0 — schema migrations (PR #113)

8 schema commits + 2 docs commits on `clients-projects-redesign`:

- New enum `workflow_stage` (brief / production / mixing / mastering / done) — 5 values, NOT the prototype's 6 (Gili dropped Review and Delivery).
- `client_contacts.invited_at` (timestamptz, nullable) — linkpill "Invited" state
- `client_contacts.position` (int, NOT NULL, default 0) — drag-reorder
- `projects.position` (int, NOT NULL, default 0) — drag-reorder
- `projects.workflow_stage` (workflow_stage, NOT NULL, default 'brief') — parallel to legacy `stage`
- `project_tracks.workflow_stage` (same enum) — per-song stepper
- `bookings.song_id` (uuid, nullable, FK → project_tracks ON DELETE SET NULL) — per-song Sessions tab
- SQL migration `packages/db/drizzle/0011_clients_projects_redesign.sql` — idempotent

7 new tests in `packages/db/src/__tests__/clients-projects-redesign.test.ts` — pure-runtime Drizzle column metadata assertions; no DB required.

Spec compliance: ✅ verified line-by-line by a spec-reviewer subagent.
Code quality: ✅ "ship it" from code-reviewer subagent. Two minor follow-ups noted (FK `onDelete` and `withTimezone` not asserted by tests — non-blocking).

## What's NOT done

### Phases 1 – 4 (planned, not yet started)

| Phase | What ships | Risk |
|---|---|---|
| **1** | List view + Client Space polish + drag reorder + linkpill + Invite modal | Low |
| **2** | New Album page (replaces current Project Room) + Studio Log + Payments tab | Medium |
| **3** | Song Space (NEW route) + Single-rule routing + workflow stepper + wire VersionRow play to existing PersistentPlayer | Medium |
| **4** | Upload Track modal with stage picker + manual stage edit | Low |
| **(later, optional)** | PersistentPlayer visual polish to match prototype's `#player` spec | High |

Each phase: TDD-first, `/skitza-verify` green, Incognito preview verified, separate PR.

### To ship Phase 0 to production

1. **Raz reviews PR #113.** Schema is his territory per CLAUDE.md, but Gili authorized me to write these migrations directly for this redesign (recorded in memory `feedback_schema_authorized_clients_projects.md`). The 6 column adds + 1 new enum are all additive and idempotent.
2. On Raz's approval: merge PR #113. Vercel deploy hook applies the migration to prod DB automatically.
3. No need for Gili to apply locally — Task 10 of the Phase 0 plan was deliberately skipped after `apply-migrations.mjs` failed twice on quoted DATABASE_URL handling.
4. Once merged: pull `v3-clean` locally, then start Phase 1 by writing `docs/plans/active/2026-05-14-clients-projects-redesign-phase-1.md`.

## Decisions log (chronological, all 2026-05-14)

1. **Q1 Scope** — option A: full faithful port (replace current Project Room IA; add Song Space; add Single-Space rule).
2. **Q2 Schema work** — option A: Gili authorized Claude to write the migrations directly. Raz reviews PR before merge. Scoped to this redesign only.
3. **Q3 Notes tab** — drop entirely. `projects.notes` column stays in DB but no UI exposes it.
4. **Q4a Project stage** — option A: ADD a new `workflow_stage` column rather than replace the legacy `stage` enum. Legacy enum keeps running billing; new column drives only the new UI.
5. **Q4b Stage advancement** — option B: upload-driven + manual override. Upload Track modal has a stage picker; song page has a small "change stage" affordance.
6. **5-stage workflow vs prototype's 6** — Gili dropped Review and Delivery. Final list: Brief → Production → Mixing → Mastering → Done.
7. **Q5 Floating player** — reuse existing `PersistentPlayer` (mounted globally in `app-shell.tsx`). Comment at `app-shell.tsx:82-89` says Phase 4 will swap it; for now we wire VersionRow's play button to `playerPlay()` and use `useNowPlaying()` for the amber highlight. No new audio infrastructure.
8. **Q6 Phasing** — 5 separate PRs (Phase 0 schema, 1 list+client, 2 album, 3 song space, 4 upload modal). Optional Phase 5: player visual polish.

## How to resume in a new session

1. **Read this recap first.** It points to everything.
2. **Read the design brief.** `docs/plans/active/2026-05-14-clients-projects-redesign-design.md` is the source of truth for every decision.
3. **Confirm branch state.** `git rev-parse --abbrev-ref HEAD` should be on `clients-projects-redesign` until PR #113 merges. After merge, `git checkout v3-clean && git pull` and start Phase 1 on a new branch off v3-clean.
4. **Confirm pipeline.** `pnpm typecheck && pnpm -F web lint && pnpm test` should be green.
5. **Ask Gili what's next.** Options on the table: (a) Phase 1 plan, (b) wait on PR #113 merge before starting any new phase work.

## Token reality check (carry this forward)

Same as storefront recap. The Skitza app uses ONLY these CSS custom properties:

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

## Testing convention (carry forward)

Vitest in `node` env, no jsdom, no `@testing-library/react`. Two patterns:

1. **Pure-function unit tests** — standard `expect(...)` on helpers (e.g. the Phase 0 column-metadata tests).
2. **Source-grep tests on JSX shells** — `readFileSync` the `.tsx` file, assert it contains key imports / class names / attributes.

No DOM interactions. Behavior is exercised by real consumers + manual preview verification.

## Auxiliary stashes (recoverable)

- `stash@{0}: On clients-projects-redesign: pre-clients-projects-redesign: dashboard simplification WIP` — 4 files (page.tsx, page-helpers.ts, page-rebuild.test.ts, empty-onboarding.tsx). These were carried over from before our session; landed on `fix/dashboard-overview-after-onboarding` instead. Gili can `git stash pop` if useful; otherwise drop.

## Branch state details

```
clients-projects-redesign
├── 10 commits ahead of origin/v3-clean
├── 8 schema commits + 2 docs commits
├── Includes:
│   ├── fcd4a7a  docs: design brief for v3 redesign
│   ├── 96551a9  docs: Phase 0 implementation plan
│   ├── eb332d9  feat(db): workflow_stage enum
│   ├── 1c65ebf  feat(db): client_contacts.invited_at
│   ├── 56484a2  feat(db): client_contacts.position
│   ├── ae0e8ba  feat(db): projects.position
│   ├── af917c4  feat(db): projects.workflow_stage
│   ├── 53f3748  feat(db): project_tracks.workflow_stage
│   ├── 01a7cb2  feat(db): bookings.song_id FK
│   └── ed32a5e  feat(db): SQL migration 0011
└── PR #113 open against v3-clean, awaiting Raz review
```
