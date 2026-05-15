# Clients & Projects — Phase 2: Album Page

> **For Claude:** Implement via subagent-driven-development. TDD throughout. One commit per logical unit.

**Goal:** Replace the current 5-sub-tab Project Room at `/dashboard/clients-projects/[id]` with the new Album Page IA from `DESIGN.md §4.3` + `BUILD-NOTES §5.3`. Dark gradient hero + 4 stat tiles + 4 tabs (Songs · Files · Payments · Studio Log) + new TrackRow. URL stays the same.

**Architecture:** Bottom-up — pure helpers (stage colors, stage labels) → atoms (TrackRow) → composed surfaces (AlbumHero, AlbumStatStrip, AlbumTabs) → tab content panels (Songs/Files/Payments/Studio Log) → page.tsx rewrite. Typecheck stays green at every step.

**Branch:** Continuing on `clients-projects-phase-1` (PR #117 grows). Worktree at `/Users/giliasraf/skitza-phase-1`.

**Status:** Phase 1 done (G1-G5 + G6). Phase 2 starts here.

---

## Decisions baked in

| # | Decision | Reasoning |
|---|---|---|
| 1 | **Continue on `clients-projects-phase-1`** — one big PR, not separate per phase | Gili wants the full design as one deliverable. QA passes once over everything. |
| 2 | **Workflow stages: 5, not 6** | Brief → Production → Mixing → Mastering → Done. Gili dropped Review + Delivery (carryover from Phase 0). |
| 3 | **Reuse existing FilesSubTab** | `apps/web/src/components/dashboard/project/sub-tabs/files-sub-tab.tsx` already does contracts + drive links. Wrap, don't rebuild. |
| 4 | **Old sub-tab files stay (orphaned) until a cleanup commit** | Big-bang risk = small. They'll be deleted at the end of Phase 2 once new IA is wired. |
| 5 | **Stage pill colors per BUILD-NOTES §6.4** (Skitza adaptation) | brief→slate, production→indigo, mixing→amber, mastering→emerald, done→emerald. |
| 6 | **Single-Space rule lives in Phase 3** | Phase 2 always shows AlbumSpace. Phase 3 adds the server-side redirect for `count === 1`. |
| 7 | **Hero CTAs use existing `HeroCTA` component from Phase 1** | Variants: `play` (solid white) + `upload` (frosted glass). Both 999px radius. |
| 8 | **TrackRow click navigates to `[id]/songs/[songId]` even before Phase 3 ships** | The link works; clicking shows a 404 until Phase 3 lands. Acceptable since we're shipping all phases together. |

---

## Component plan

### New helpers
- `apps/web/src/lib/clients/workflow-stage.ts` — pure helper. Exports `WORKFLOW_STAGES` (5-entry list with `key`/`label`/`sub`), `stageColor(stage)` mapping to a Skitza CSS color string, `stageLabel(stage)`, `stageOrder` array for steppers.

### New atoms
- `apps/web/src/components/dashboard/project/track-row.tsx` — the new `.trackrow` from DESIGN.md §5.4. Grid: `22px 30px 38px minmax(0,1fr) 130px 180px 22px`. Drag handle · `01` index · cover · title+meta · stage pill (colored dot) · progress + % · chevron. Whole row clickable → `/clients-projects/[id]/songs/[songId]`. `draggable="true"`.

### New composed
- `apps/web/src/components/dashboard/project/album-hero.tsx` — dark gradient band. Avatar 112px (gradient via `deriveGradient(project.name)`, hero bg via `heroBg(token)`). Eyebrow `PROJECT · <STAGE>`. Title + meta (`<Client> · <n> songs · <m> sessions · <total fee>`). Right-side: `<HeroCTA variant="play">Play latest</HeroCTA>` + `<HeroCTA variant="upload">Add song</HeroCTA>`. Imports existing helpers from `~/lib/clients/derive-gradient` + `~/lib/clients/hero-bg`.
- `apps/web/src/components/dashboard/project/album-stat-strip.tsx` — 4 `StatTile`s (Status pill · Progress + bar · Deadline · Outstanding). Same StatTile component used elsewhere; danger variant on deadline-overdue + outstanding > 0.
- `apps/web/src/components/dashboard/project/album-tabs.tsx` — pill-shaped tab bar (`Songs (n) · Files · Payments · Studio Log`). Active tab = `--fg-default` bg + white text. Local `useState` for active tab (URL `?tab=` hydration is fast-follow). Use the existing tabs floating pill pattern (see prototype CSS `.tabs`).

### New tab content panels (one file each)
- `apps/web/src/components/dashboard/project/album-tabs/songs-tab.tsx` — wraps a list of `<TrackRow>`. Empty state when no tracks. "Add song" CTA in the panel header opens the Upload Track modal (Phase 4 wires the modal; for now: render the button as a `<button>` with a no-op `onClick` + TODO comment).
- `apps/web/src/components/dashboard/project/album-tabs/files-tab.tsx` — thin wrapper that re-exports `FilesSubTab` from `~/components/dashboard/project/sub-tabs/files-sub-tab`. Pure delegation so the new IA can swap it out later.
- `apps/web/src/components/dashboard/project/album-tabs/payments-tab.tsx` — consolidates the Outstanding card (Total/Paid/Balance) + Milestones list from the current OverviewSubTab. Reads from `caller.project.money({ projectId })` (existing).
- `apps/web/src/components/dashboard/project/album-tabs/studio-log-tab.tsx` — consolidates the activity timeline + sessions list. Reuses `SessionsSubTab` content inline (or extracts the row component if cleaner). Sub-header insights (per DESIGN §4.3): Sessions logged · Studio hours · This month · Last session.

### AlbumSpace shell
- `apps/web/src/components/dashboard/project/album-space.tsx` — owns active-tab state, composes `AlbumHero` + `AlbumStatStrip` + `AlbumTabs` + the active tab's content panel. Takes props: project, tracks, money, sessions, gradient token, etc.

### Page wire-up
- Modify `apps/web/src/app/(producer)/dashboard/clients-projects/[id]/page.tsx`:
  - Remove imports of `ProjectHeader`, `ProjectRoomHero`, `ProjectStatStrip`, `ProjectSubTabs`, all `sub-tabs/*` except `FilesSubTab` (via the new wrapper)
  - Remove legacy `?tab=money` resolver (the new AlbumTabs owns this)
  - Server-fetch project detail + money + sessions in parallel
  - Render `<AlbumSpace project={...} tracks={...} money={...} sessions={...} />`

### Cleanup (last commit)
After Phase 2's main commits, run `git rm` on the now-orphaned files. Discovery step: `rg "from .*<filename>" apps/web/src --type ts --type tsx` for each. Expected unreachable after Phase 2:
- `apps/web/src/components/dashboard/project/project-header.tsx`
- `apps/web/src/components/dashboard/project/project-room-hero.tsx`
- `apps/web/src/components/dashboard/project/project-stat-strip.tsx`
- `apps/web/src/components/dashboard/project/project-sub-tab-shared.ts`
- `apps/web/src/components/dashboard/project/project-sub-tabs.tsx`
- `apps/web/src/components/dashboard/project/sub-tabs/music-sub-tab.tsx`
- `apps/web/src/components/dashboard/project/sub-tabs/notes-sub-tab.tsx`
- `apps/web/src/components/dashboard/project/sub-tabs/overview-sub-tab.tsx`
- `apps/web/src/components/dashboard/project/sub-tabs/money-sub-tab.tsx`

Do NOT delete:
- `files-sub-tab.tsx` (still used via wrapper)
- `sessions-sub-tab.tsx` (might extract row component into studio-log-tab)
- `add-charge-modal.tsx`, `edit-project-modal.tsx`, `tag-editor.tsx` (out of scope, used elsewhere)
- `project-timeline.tsx` (might be reused in studio-log-tab)

---

## Test strategy (TDD)

Established pattern: source-grep on JSX shells, pure-function tests for helpers, mock-driven tests for tRPC routers.

- `workflow-stage.test.ts` — assert WORKFLOW_STAGES has 5 entries with correct keys/labels, `stageColor()` returns Skitza tokens, `stageOrder` is correct.
- `track-row.test.tsx` — assert grid columns class, draggable attribute, link to `/clients-projects/[id]/songs/[songId]`, stage pill rendering, no forbidden CSS tokens.
- `album-hero.test.tsx` — assert eyebrow PROJECT, h1, meta line, HeroCTA imports, deriveGradient/heroBg usage, no forbidden tokens.
- `album-stat-strip.test.tsx` — assert 4 StatTile renders, danger variants on overdue/outstanding.
- `album-tabs.test.tsx` — assert 4 tab labels, default tab = `songs`, role=tablist + tab + aria-selected.
- `songs-tab.test.tsx` — assert TrackRow used, empty state, "Add song" button.
- `files-tab.test.tsx` — assert it delegates to FilesSubTab.
- `payments-tab.test.tsx` — assert money fields, milestones, currency rendering.
- `studio-log-tab.test.tsx` — assert insight tiles + session rows + activity timeline.
- `album-space.test.tsx` — assert hero + stat strip + tabs + active panel composition.
- `page-shell.test.ts` — assert page.tsx imports AlbumSpace, removes old imports.

---

## Done criteria

- [ ] All 12 new files created with tests
- [ ] All 9 cleanup deletions
- [ ] `[id]/page.tsx` renders `<AlbumSpace>`
- [ ] `pnpm typecheck` clean
- [ ] `pnpm -F web lint` zero warnings
- [ ] `pnpm test` all green
- [ ] No forbidden CSS tokens
- [ ] Commits one-per-task, all with Co-Authored-By trailer

---

## What this DOES NOT cover (Phase 3+ work)
- Song Space (`[id]/songs/[songId]` route + SongSpace component + WorkflowStepper + VersionRow)
- Single-Space rule (server-side redirect when 1 song)
- Breadcrumb suppression in single mode
- Upload Track modal (Phase 4)
- "Add song" button in Songs tab is a stub — wired in Phase 4
- "Play latest" hero CTA is a stub — wired in Phase 3 (needs VersionRow wiring)
