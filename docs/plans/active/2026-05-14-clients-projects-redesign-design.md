# Clients & Projects Redesign — Design Brief

**Date:** 2026-05-14
**Author:** Gili (founder) + Claude
**Branch:** `clients-projects-redesign` (off `origin/v3-clean`)
**Status:** Approved by Gili 2026-05-14. Ready for Phase 0.

> **For the next session:** This document is the source of truth. Every decision below was confirmed in the brainstorm session of 2026-05-14. Do not deviate without re-approval from Gili.

---

## TL;DR

A full faithful port of the **Clients Projects Room** prototype into Skitza, replacing the current 5-sub-tab Project Room with a new IA: List → Client Space → Album Page → Song Space, plus a "Single-Space rule" for 1-song projects. Ships in 5 incremental phases, each with its own PR. TDD throughout. Reuses the existing `PersistentPlayer` — no new audio infrastructure.

## Source materials

- `/Volumes/KINGSTON/Downloads/Clients Projects Room.html` — the prototype (single-file vanilla DOM, source of truth for visuals)
- `/Volumes/KINGSTON/Downloads/DESIGN.md` — design tokens, layout, component spec
- `/Volumes/KINGSTON/Downloads/BUILD-NOTES.md` — engineering handoff with data shapes, routing rules, modal specs

If anything in this design doc conflicts with the HTML, the HTML wins — except where this doc explicitly diverges (logged in §3 below).

---

## 1. Decisions log (from the 2026-05-14 brainstorm)

| Q | Decision | Notes |
|---|---|---|
| **1. Scope** | **Full faithful port** | Replace current Project Room IA. Add Song Space. Add Single-Space rule. |
| **2. Database changes** | **Authorized — I write the migrations, Raz reviews before merge** | Overrides the CLAUDE.md "Raz owns schema" default for this work only. |
| **3. Notes tab** | **Dropped** | `projects.notes` column stays in DB but no UI exposes it. |
| **4a. Project stage** | **Add new column `workflow_stage`**, do **not** replace existing `stage` enum | Old `stage` keeps running billing. UI only ever shows `workflow_stage`. |
| **4b. Stage advancement** | **Upload-driven + manual override** | Upload Track modal has a stage picker. Song page has a small "change stage" affordance. |
| **5. Floating player** | **Reuse existing `PersistentPlayer`** | Already mounted in `app-shell.tsx`. `useNowPlaying()` already drives the now-playing highlight. |
| **6. Phasing** | **5 phases, separate PRs** | Phase 0 (schema) → Phase 1 (list + client) → Phase 2 (album) → Phase 3 (song space) → Phase 4 (upload modal). |
| **5-stage workflow** | Gili's spec: **Brief → Production → Mixing → Mastering → Done** | Diverges from prototype's 6 (drops Review and Delivery). |

---

## 2. Routing / Information Architecture

### Routes after redesign

| URL | What it is | Status |
|---|---|---|
| `/dashboard/clients-projects` | List with Clients / Projects tabs | Visual rebuild |
| `/dashboard/clients-projects/clients/[id]` | Client Space (hero + linkpill + projects) | Visual rebuild + linkpill |
| `/dashboard/clients-projects/[id]` | **Album Page** (when project has >1 song) | New content replaces existing Project Room |
| `/dashboard/clients-projects/[id]/songs/[songId]` | **Song Space** (NEW) | New route |
| `/dashboard/clients-projects/new` | New Project form | Add required Store Product picker |

### Single-Space rule

- `/dashboard/clients-projects/[id]` checks `count(project_tracks where project_id = id)`.
- If `count === 1` → redirect to `/dashboard/clients-projects/[id]/songs/<that-song-id>`.
- Implemented server-side via `redirect()` in `page.tsx` so deep-links also collapse correctly.

### Breadcrumb logic

- **List:** `Clients & Projects`
- **Client Space:** `Clients & Projects › <Client>`
- **Album:** `Clients & Projects › <Client> › <Project>`
- **Song Space (album mode):** `Clients & Projects › <Client> › <Project> › <Song>`
- **Song Space (single mode):** `Clients & Projects › <Client> › <Project>` — the album crumb is **suppressed** because the song IS the project.

### Music library stays untouched

`/dashboard/music/*` is the producer's listening + commenting surface. It coexists with the new Song Space (which is the workflow surface). They share the underlying `projectTracks` + `trackVersions` data but render different views. Confirmed in project memory: *"Don't mix them up."*

---

## 3. Divergences from the prototype

These are deliberate departures from the source HTML/DESIGN.md/BUILD-NOTES.md:

1. **5-stage workflow, not 6.** Gili dropped Review and Delivery. Final list: Brief / Production / Mixing / Mastering / Done.
2. **No Notes tab.** Prototype keeps it on the album. Gili confirmed drop.
3. **Old `project.stage` enum stays in the DB.** Prototype treats stage as a workflow enum; we keep two parallel concepts (lifecycle vs. creative) for safety.
4. **`workflow_stage` is a new column**, not a rename of `stage`.
5. **PersistentPlayer is reused.** The prototype defines a new `FloatingPlayer`; we use the dock already mounted in the app shell. Visual polish to match the prototype's dock is a fast-follow, not blocking.
6. **Gradient is derived from name hash**, not stored as a column. Deterministic + zero migration cost.
7. **Hero CTAs ("Add song", "Play latest")** dispatch into existing event bus (`skitza:player:set`) rather than owning audio state directly.

---

## 4. Schema migrations (Phase 0)

All changes are **additive**. Nothing dropped, nothing renamed.

### New enum

```sql
CREATE TYPE workflow_stage AS ENUM ('brief', 'production', 'mixing', 'mastering', 'done');
```

### Column adds

| Table | Column | Type | Default | Why |
|---|---|---|---|---|
| `client_contacts` | `invited_at` | `timestamp with time zone` | `NULL` | linkpill "Invited" state |
| `client_contacts` | `position` | `integer` | `0` | drag-to-reorder on Clients list |
| `projects` | `position` | `integer` | `0` | drag-to-reorder on Projects list |
| `projects` | `workflow_stage` | `workflow_stage` | `'brief'` | hero + Status stat tile |
| `project_tracks` | `workflow_stage` | `workflow_stage` | `'brief'` | per-song stepper + tracklist pill |
| `bookings` | `song_id` | `uuid REFERENCES project_tracks(id) ON DELETE SET NULL` | `NULL` | per-song Sessions tab |

### Migration file plan

- `packages/db/drizzle/00NN_clients_projects_redesign.sql` (single SQL migration).
- Drizzle schema update in the same Phase 0 PR.
- Backfill: all existing rows take the default values. No data transformation needed.
- Raz reviews Phase 0 PR before merge.

### Rollback

Each column add is independently reversible (`ALTER TABLE … DROP COLUMN`). The new enum can be `DROP TYPE … CASCADE`. No dependent code ships in Phase 0, so rolling back the migration is safe until Phase 1 lands.

---

## 5. Component plan

### Reuse as-is

- `ProducerSidebar`, `ProducerBottomNav` (chrome — already finished)
- `PersistentPlayer` + `playerPlay()` + `useNowPlaying()` (audio dock + state)
- `getShellState()` (server-side topbar context)
- Existing breadcrumbs scaffolding

### Rebuild (visual + new behavior)

- **`ClientsListScreen`** — new KPI block, filter chips, sort dropdown with drag-to-reorder, layout toggle (cards / table)
- **`ProjectsList`** — same as above, with new `ProjectRow` visuals (status pill, progress bar, balance, deadline, chevron)
- **`ClientSpace`** — new dark hero, gradient, linkpill, stats grid, project list
- **`NewProjectForm`** — add required Store Product picker, auto-fill total

### New components

| Component | File | Job |
|---|---|---|
| `LinkPill` | `~/components/dashboard/clients/link-pill.tsx` | active / pending / none states; button → opens Invite modal |
| `WorkflowStepper` | `~/components/dashboard/song/workflow-stepper.tsx` | 5-step horizontal stepper with green fill + amber pulse |
| `TrackRow` | `~/components/dashboard/project/track-row.tsx` | album tracklist row |
| `VersionRow` | `~/components/dashboard/song/version-row.tsx` | wired to `playerPlay()` + `useNowPlaying()` for amber highlight |
| `HeroCTA` | `~/components/dashboard/common/hero-cta.tsx` | white "Play latest" + frosted "Upload" pills |
| `StatTile` | `~/components/dashboard/common/stat-tile.tsx` | uniform stat tile w/ danger/ok variants |
| `AlbumSpace` | `~/components/dashboard/project/album-space.tsx` | wraps the new 4 tabs |
| `SongSpace` | `~/components/dashboard/song/song-space.tsx` | wraps the new tabs (Album mode: 3; Single mode: 4) |
| `GradientDeriver` | `~/lib/clients/derive-gradient.ts` | pure: name → grad token via hash |

### Modals (4 total)

| Modal | New / existing | Notes |
|---|---|---|
| **New Client** | Lightly extend existing | Auto-pick gradient; if email present → set `invited_at` on submit and `linked = pending` |
| **New Project** | Extend existing form at `/new` | Add required Store Product picker, auto-fill total, render deliverables+terms hint |
| **Upload Track** | New (Phase 4) | Song picker (existing / + New song), version label, **stage selector**, change description, file drop zone. On submit: insert SongVersion + advance `project_tracks.workflow_stage` |
| **Invite to App** | New (Phase 1) | Client preview · Send invite email (Resend) · Copy invite link. Both set `invited_at` and `linked = pending`. |

### Audio playback wiring

```ts
// In VersionRow.tsx
import { playerPlay, useNowPlaying } from "~/components/audio/persistent-player";

function VersionRow({ version, songTitle, projectName }) {
  const { trackId, playing } = useNowPlaying();
  const isCurrent = trackId === version.id;

  return (
    <div className={isCurrent ? "verrow current" : "verrow"} onClick={() => {
      playerPlay({
        id: version.id,
        audioUrl: version.audioUrl,
        title: songTitle,
        subtitle: `${projectName} · ${version.label}`,
        durationMs: version.durationMs,
      });
    }}>
      …
    </div>
  );
}
```

This is the **only** integration point between the new clients-projects routes and the audio dock. No new audio infrastructure.

---

## 6. The 5 phases

Each phase = one PR opened against `v3-clean`. Pipeline gate (`/skitza-verify` = typecheck + lint + tests) is required green before push. Vercel preview verified in Incognito before merge.

### Phase 0 — Schema + design doc

- Commit this design doc
- Add migration `00NN_clients_projects_redesign.sql`
- Update `packages/db/src/schema.ts` (add columns + new enum)
- Unit-test the new column types
- No UI changes
- **Raz reviews + approves before merge**

### Phase 1 — List view + Client Space + invite flow

- Visual rebuild of `/dashboard/clients-projects` (KPIs, filter chips, sort, drag)
- Visual rebuild of `/dashboard/clients-projects/clients/[id]` (dark hero, linkpill, stats)
- `LinkPill` component (3 states)
- `InviteToApp` modal (email via Resend + copy-link via `navigator.clipboard.writeText`)
- New tRPC mutation `clientContacts.sendInvite` (sets `invited_at`, emits notification, optionally sends email)
- Drag-reorder mutations: `clientContacts.reorder`, `projects.reorder`
- Gradient derivation helper

### Phase 2 — Album Page (replace Project Room)

- New `AlbumSpace` component at `/dashboard/clients-projects/[id]`
- 4 tabs: **Songs · Files · Payments · Studio Log**
- Dark hero with project gradient
- 4 stat tiles in hero
- `TrackRow` component (tracklist with stage pill + progress bar)
- "Files" tab keeps the existing FilesSubTab content (contracts + drive links)
- "Payments" tab consolidates the money strip + milestones from current Overview
- "Studio Log" consolidates the activity timeline + sessions list
- Old `[id]/page.tsx` content replaced; URL unchanged

### Phase 3 — Song Space + Single-Space rule

- New route `[id]/songs/[songId]/page.tsx`
- `SongSpace` component
- Tabs: **Overview · Versions · Sessions** (album mode); plus **Payments** (single mode)
- `WorkflowStepper` component (5 stages)
- `VersionRow` wired to `PersistentPlayer` (see §5)
- Single-Space rule: server-side redirect in `[id]/page.tsx`
- Crumb suppression in single mode
- "Add a new version" drop-zone as first row inside the Versions tab (not a banner)

### Phase 4 — Upload Track modal + manual stage edit

- New `UploadTrack` modal (song picker, version label, **stage selector**, description, drop zone)
- On submit: insert `trackVersions` row, set `project_tracks.workflow_stage` to picked stage
- "Change stage" affordance on song page (small menu)
- Hooks into existing R2 presigned-URL flow

### Optional fast-follow — PersistentPlayer visual polish

- Restyle the dock to match the prototype's `#player` spec (waveform, EQ bars, larger duration mono, etc.)
- Pure CSS / DOM change; no new event bus needed
- Separate PR if/when Gili wants it

---

## 7. Testing strategy (TDD)

Matches the patterns already proven in storefront-redesign-phase-1 and phase-2.

### Test types

1. **Pure-function tests** (Vitest, `node` env)
   - `derive-gradient.test.ts` — name → grad mapping deterministic + stable
   - `single-space-rule.test.ts` — `count === 1 ⇒ redirect`, else album
   - `workflow-stage.test.ts` — stage advancement, transition validation
   - `breadcrumb.test.ts` — album-mode vs single-mode crumb output
   - `reorder-positions.test.ts` — drag math (compute new position arrays)

2. **Source-grep JSX shell tests** (read `.tsx` with `readFileSync`)
   - Assert imports (e.g. `version-row.test.tsx` checks for `playerPlay` + `useNowPlaying` imports)
   - Assert classNames / structure (e.g. `track-row.test.tsx` checks for `data-stage="<key>"`)
   - Assert that no forbidden CSS tokens (`--surface-card`, `--text-muted`, etc. from the memory note) are present

3. **tRPC procedure tests** (existing pattern in `apps/web/src/server/trpc/routers/__tests__/`)
   - `clientContacts.sendInvite.test.ts` — sets `invited_at`, emits notification
   - `clientContacts.reorder.test.ts` — atomic position update
   - `projects.reorder.test.ts` — same
   - `bookings.songId.test.ts` — backfill safe (NULL allowed)

### TDD discipline

For each phase:

1. Write failing test for the new behavior.
2. Implement the smallest change to make it pass.
3. Refactor with all tests green.
4. Run `/skitza-verify` before push.

No skipping. No "we'll add tests later". Per Gili's brief.

### Manual verification (post-merge)

- Vercel preview URL, opened in **Incognito** (memory: SW cache gotcha)
- Smoke-test the golden paths in BUILD-NOTES §10 verification checklist:
  - Single-rule works (Tamar Eisenberg's Daydream-equivalent fixture)
  - Album page has 4 tabs (Songs/Files/Payments/Studio Log)
  - Song Space has 3 tabs (album) or 4 (single)
  - Stepper green-fills correctly
  - Version play sets amber highlight
  - Invite-to-app pill opens modal with both options
  - New Project requires Store Product
  - Drag flips sort to Custom
  - Esc climbs one level
  - PersistentPlayer persists across navigation

---

## 8. Safety rules (do not break)

1. **No file outside this brief is touched.** If we need to change something in a different feature, surface it and stop.
2. **No existing route is removed.** Old `[id]/page.tsx` is rewritten in place in Phase 2; URL preserved.
3. **`/dashboard/music/*` is off-limits.** Confirmed coexistence per project memory.
4. **All schema changes additive.** Worst case = unused columns.
5. **Phase 0 ships migrations alone.** No code that depends on the new columns lands in the same PR.
6. **Skitza CSS tokens** (memory `feedback_skitza_css_tokens.md`): use `--bg-elevated`, `--fg-muted`, `--fg-default`, `--bg-sidebar`, `rgb(17_16_9/0.06)` for hover. Never use `--surface-card`, `--text-muted`, `--text-strong`, `--surface-hover`, `--brand-primary-on` — they don't exist and resolve to invisible.
7. **Pre-push gate is mandatory**: `pnpm typecheck && pnpm -F web lint && pnpm test` must pass (memory `feedback_run_lint_not_just_typecheck.md`). Vercel runs ESLint with `--max-warnings 0`.
8. **Each phase is a separate PR opened against `v3-clean`.** Direct push to `v3-clean` is blocked (memory).
9. **Old `project.stage` enum + `paid` flow are not touched.** Billing keeps working.

---

## 9. Open questions / fast-follows (not blocking)

- **Hero animation polish** (workflow stepper amber pulse, drift on hover, etc.) — defer to a "polish PR" after Phase 4.
- **Mobile** — CLAUDE.md says producer is desktop-only. We don't ship a mobile design. Bottom nav stays as-is.
- **i18n** — English only (CLAUDE.md). No Hebrew rendering work in this redesign.
- **Drag reorder UX** — keyboard accessibility (arrow keys) deferred to fast-follow.
- **Per-song attendee avatars** in Sessions tab — current `bookings` row has `artistName` only. We display the project's client + producer; future enhancement could pull invited collaborators.
- **`projects.notes` cleanup** — column stays but no UI. Decide later whether to drop it once we confirm no producers have real notes there.

---

## 10. References

- **Prototype (USB):** `/Volumes/KINGSTON/Downloads/Clients Projects Room.html`
- **Design spec:** `/Volumes/KINGSTON/Downloads/DESIGN.md`
- **Engineering handoff:** `/Volumes/KINGSTON/Downloads/BUILD-NOTES.md`
- **Existing PersistentPlayer:** [persistent-player.tsx](../../apps/web/src/components/audio/persistent-player.tsx)
- **App shell mount point:** [app-shell.tsx](../../apps/web/src/components/shell/app-shell.tsx:88)
- **Current Project Room:** [page.tsx](../../apps/web/src/app/(producer)/dashboard/clients-projects/[id]/page.tsx)
- **DB schema:** [schema.ts](../../packages/db/src/schema.ts)
- **Storefront precedent:** [2026-05-10-storefront-redesign-design.md](2026-05-10-storefront-redesign-design.md)

---

## Sign-off

- **Brainstorm date:** 2026-05-14
- **Approved by:** Gili (founder)
- **Scope:** Full faithful port, 5 phases, TDD, extra cautious
- **Next step:** Phase 0 plan written + executed via `superpowers:writing-plans` skill
