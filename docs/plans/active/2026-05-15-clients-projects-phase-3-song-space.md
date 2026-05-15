# Clients & Projects — Phase 3: Song Space + Single-Space rule

> **For Claude:** Implement via subagent-driven-development. TDD throughout.

**Goal:** Add the new `/dashboard/clients-projects/[id]/songs/[songId]` route per `DESIGN.md §4.4` + `BUILD-NOTES §5.4`. New components: `SongSpace`, `WorkflowStepper`, `VersionRow` wired to the existing `PersistentPlayer`, `AddVersionDropZone`, `SongTabs`, plus content panels (Overview / Versions / Sessions / Payments-single-only). Add the **Single-Space rule**: `[id]/page.tsx` redirects to `songs/[songId]` when the project has exactly 1 track. Suppress the album crumb in single mode.

**Architecture:** Bottom-up — helpers (already done in Phase 2) → atoms (VersionRow, AddVersionDropZone) → composed (WorkflowStepper, SongSpaceHero, SongTabs) → tab content panels → SongSpace shell → new page.tsx → redirect in `[id]/page.tsx` → breadcrumb suppression.

**Branch:** Continuing on `clients-projects-phase-1`. HEAD before Phase 3: `ae6adcc`. Worktree at `/Users/giliasraf/skitza-phase-1`.

---

## Decisions baked in

| # | Decision | Reasoning |
|---|---|---|
| 1 | **5-stage WorkflowStepper, not 6** | Matches Gili's Phase 0 enum + `workflow-stage.ts` helper. The prototype's "Review" and "Delivery" are folded into "Mixing" + "Mastering" + "Done". |
| 2 | **VersionRow uses existing PersistentPlayer** | `playerPlay()` + `useNowPlaying()` from `~/components/audio/persistent-player`. No new audio infrastructure. |
| 3 | **"Add new version" is the first row of Versions tab**, not a banner | Per `DESIGN.md §4.4` — "first row of the Versions tab is a slim drop-zone with `+` icon · WAV/MP3 hint". Same row geometry as VersionRow. |
| 4 | **Single-Space rule = server-side redirect in `[id]/page.tsx`** | `if (tracks.length === 1) redirect(...)`. Implemented BEFORE rendering AlbumSpace. Catches every entry point (clients list, client space, deep link). |
| 5 | **Single mode = Song Space hides the album breadcrumb** | "Clients & Projects › Tamar Eisenberg › Daydream" — the song name IS the project name. No middle "Album" crumb. |
| 6 | **Album mode = 3 tabs (Overview · Versions · Sessions)** | Single mode = 4 tabs (extra Payments). Per `DESIGN.md §4.4`. |
| 7 | **Tab default = Overview** | Both modes. Local `useState` until URL hydration ships as fast-follow. |
| 8 | **Upload button stays disabled** (Phase 4 wires it) | The "Upload new version" hero CTA + the AddVersionDropZone click both show as disabled with `title="Coming soon"`. Wired in Phase 4. |
| 9 | **Stage advancement on a song is manual via a small "change stage" menu** | Per design Q4b decision. Stub the menu (visible, disabled). Phase 4 makes it functional. |

---

## Component plan

### New helpers
None — `workflow-stage.ts` already exists from Phase 2.

### New atoms
- `apps/web/src/components/dashboard/song/version-row.tsx` — Per `DESIGN.md §5.5` + `BUILD-NOTES §6.6`. Grid: `36px minmax(0,1fr) 48px 48px 56px 32px`. Cover (36px gradient) · title + meta (`uploaded by · when · changelog`) · version tag (mono, e.g. `v3`) · duration mono · comment count `💬3` · play button. Wired to `playerPlay()` + `useNowPlaying()`. Amber wash + 3px amber left bar when `now playing`.
- `apps/web/src/components/dashboard/song/add-version-drop-zone.tsx` — Slim drop zone with `+` circle icon + headline "Add a new version" + WAV/MP3 hint. Same row geometry as VersionRow (so it slots in as the first row of the Versions tab). Click opens Upload Track modal (Phase 4 — for now: `disabled` state).

### New composed
- `apps/web/src/components/dashboard/song/workflow-stepper.tsx` — Per `DESIGN.md §5.8` + `BUILD-NOTES §6.5`. 5-step horizontal stepper. Grid `repeat(5, 1fr)`. Each step: 30px round dot with step number (or `✓` when done) + label + sub-label. Connector line is `--border-subtle`; an amber-to-green fill (`--wf-fill`) animates to cover all *done* segments using `--wf-fill` CSS variable. Active step uses amber + outer ring + soft pulse (1.8s `wfpulse` keyframe). Respect `prefers-reduced-motion`.
- `apps/web/src/components/dashboard/song/song-space-hero.tsx` — Dark gradient band (uses project's gradient via `heroBg(deriveGradient(project.name))`). Eyebrow `SONG · <STAGE>` (album mode) or `SINGLE · <STAGE>` (single mode). Title (song title) + meta. Album mode meta: `from <ProjectName> · v3 · 8 notes · 04:02`. Single mode meta: `<ClientName> · v3 · 8 notes · 04:02`. Right side: `<HeroCTA variant="play">Play latest</HeroCTA>` + `<HeroCTA variant="upload">Upload new version</HeroCTA>` (latter disabled until Phase 4).
- `apps/web/src/components/dashboard/song/song-space-stat-strip.tsx` — 4 StatTiles: Status (stage) · Progress + bar · Deadline (string, danger if overdue) · Versions (current label like "v3" + sub-text "+ 5 revisions").
- `apps/web/src/components/dashboard/song/song-tabs.tsx` — Pill-shaped tab bar mirroring AlbumTabs structure. Album mode: 3 tabs (Overview · Versions (n) · Sessions). Single mode: 4 tabs (extra Payments). Default tab = `overview`.

### New tab content panels (4)
- `apps/web/src/components/dashboard/song/song-tabs/overview-tab.tsx` — Top: full-width `<WorkflowStepper>` card. Below in 2-column grid: **Latest versions** (top 3 via `<VersionRow>`, with "See all →" button to switch to Versions tab) + **Client snippet** (avatar + name + LinkPill + "View client" + "Message" buttons — hidden in Single mode since the client is already in the breadcrumb).
- `apps/web/src/components/dashboard/song/song-tabs/versions-tab.tsx` — `<AddVersionDropZone>` as first row, then list of all `<VersionRow>`s newest-first. Empty state when only the drop zone is showing.
- `apps/web/src/components/dashboard/song/song-tabs/sessions-tab.tsx` — Per-song session log. Each row: stacked date stamp (`14 OCT`) · session name + sub · attendee avatars · duration · "Notes" button.
- `apps/web/src/components/dashboard/song/song-tabs/payments-tab.tsx` — **Single mode only.** Same shape as the Album's PaymentsTab (Outstanding card + Milestones).

### SongSpace shell
- `apps/web/src/components/dashboard/song/song-space.tsx` — Owns active-tab state, composes hero + stat strip + tabs + active panel. Takes a `mode: "album" | "single"` prop that drives:
  - Eyebrow text (`SONG ·` vs `SINGLE ·`)
  - Meta line shape (`from <Project>` vs `<Client>`)
  - Tab count (3 vs 4)
  - Client snippet visibility (shown vs hidden)
  - Whether breadcrumb suppression hint is set in shell state (Phase 3 optional — see below)

### New page
- `apps/web/src/app/(producer)/dashboard/clients-projects/[id]/songs/[songId]/page.tsx`:
  - Server component
  - Parallel fetch: `caller.project.detail({ id })`, `caller.booking.list()` filtered
  - Locate the track by `songId`; if not found → `notFound()`
  - Compute mode: `tracks.length === 1 ? "single" : "album"`
  - Build SongSpace props (project, track, versions, comments, sessions, client snippet)
  - Render `<main class="sk-page-enter">...<SongSpace mode={mode} ... /></main>`

### Modify existing page
- `apps/web/src/app/(producer)/dashboard/clients-projects/[id]/page.tsx`:
  - After fetching `data.tracks`, add: `if (data.tracks.length === 1) redirect(\`/dashboard/clients-projects/\${id}/songs/\${data.tracks[0].id}\`)` BEFORE any rendering
  - This is the **Single-Space rule** — implemented server-side so deep-links also collapse

### Optional: breadcrumb suppression
The shell-level breadcrumb (probably in `apps/web/src/components/shell/` or similar) shows `Clients & Projects > <Client> > <Project> > <Song>`. In single mode, the `<Project>` crumb should be hidden (because the project IS the song).

**Recommendation:** investigate the shell breadcrumb mechanism first. If it's simple to pass a flag, do it. If it's complex, **defer to a fast-follow** and document in the commit message. The page itself rendering correctly is the primary deliverable.

---

## Test strategy (TDD)

- `version-row.test.tsx` — assert grid columns class, `playerPlay`+`useNowPlaying` imports, amber `--brand-primary` for `.current` styling, comment count + duration rendering, no forbidden tokens.
- `add-version-drop-zone.test.tsx` — assert "+" icon, "Add a new version" headline, WAV/MP3 hint, disabled state for Phase 3, same grid shape as VersionRow.
- `workflow-stepper.test.tsx` — assert 5 steps, `--wf-fill` CSS var, `.done` vs `.now` states, prefers-reduced-motion guard, dots are 30px.
- `song-space-hero.test.tsx` — assert eyebrow switches between `SONG ·` and `SINGLE ·`, meta switches between `from <Project>` and `<Client>`, both HeroCTAs (Upload one disabled), no forbidden tokens.
- `song-space-stat-strip.test.tsx` — assert 4 StatTile labels (Status / Progress / Deadline / Versions), danger variant on overdue, ok/danger on outstanding.
- `song-tabs.test.tsx` — assert 3 tabs in album mode, 4 tabs (extra Payments) in single mode, default=overview, role=tablist + tab + aria-selected + aria-controls.
- `overview-tab.test.tsx` — assert WorkflowStepper + Latest versions list + Client snippet rendered. Client snippet hidden in single mode.
- `versions-tab.test.tsx` — assert AddVersionDropZone as first row, then list of VersionRows, empty state.
- `sessions-tab.test.tsx` — assert session rows + notes button.
- `payments-tab.test.tsx` — for the song version, similar to album's PaymentsTab.
- `song-space.test.tsx` — assert composition + mode prop dispatches correctly.
- `page-shell.test.ts` (songs/[songId]) — assert new page imports SongSpace, computes mode, parallel fetches.
- `page-shell.test.ts` (`[id]/page.tsx`) — assert the `redirect` call when `tracks.length === 1`.

---

## Done criteria

- [ ] All ~12 new components/files created with tests
- [ ] Single-Space redirect in `[id]/page.tsx`
- [ ] New page at `[id]/songs/[songId]/page.tsx` renders SongSpace
- [ ] VersionRow plays via PersistentPlayer (amber highlight on now-playing)
- [ ] WorkflowStepper renders 5 steps with green fill + amber pulse
- [ ] `pnpm typecheck` clean
- [ ] `pnpm -F web lint` zero warnings
- [ ] `pnpm test` all green
- [ ] No forbidden CSS tokens
- [ ] Commits one-per-task, all with Co-Authored-By trailer

---

## What this DOES NOT cover (Phase 4+)
- Upload Track modal — the "+" buttons are stubs (disabled with "Coming soon" tooltip)
- Manual stage advancement — the stage-edit menu is stubbed
- Real attendee avatars in Sessions tab — currently surfaces only the client name
- Full breadcrumb suppression if the shell is complex
