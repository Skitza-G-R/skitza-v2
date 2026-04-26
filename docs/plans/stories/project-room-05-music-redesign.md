# Story 05 — Music tab — drop-first uploads + version stacking + status pill

**Epic:** Project Room redesign 2026-04-26
**Architecture ref:** [`docs/plans/active/2026-04-26-project-room-redesign-architecture.md` § 5 Component tree (Music)](../active/2026-04-26-project-room-redesign-architecture.md)
**PRD anchor:** [§11.6 Music tab redesign](../../product/PRD.md)
**Depends on:** S01 (track_versions.status column), S02 (createTrackFromUpload + addVersionFromUpload + setVersionStatus mutations), S03 (sub-tab plumbing)
**Blocks:** S06 (range comments + cross-version unresolved layer over the same row)
**Subagent:** `skitza-tdd-implementer` + `skitza-ux-critic` for UI review

## Goal

End-to-end rewrite of the Music tab. Kill the title-first add-track form (the user's main complaint: "when i click upload a track it opens me the place to add title instead of letting me uploading a track"). Replace with drop-first UX: file picker fires first, title auto-fills from filename, drop-on-row creates new versions (Frame.io Version Stacking), per-version bilateral status pill (Draft/Final ↔ In progress/Approved).

## User story

As a producer, when I want to send a new version of a track to my artist, I want to **drop the file directly** — no form filling, no extra steps. The system should figure out the title from my filename, give me a clean version stack, and let me mark a version "Final" with one click — visible to the artist as "Approved" in their app.

## Acceptance criteria

### Drop-first add-track UX
- [ ] **Empty state** — when the project has zero tracks, the Music tab body IS a large drop zone. Copy: "Drop audio files or click to choose." Click anywhere → file picker. Drag a file over → highlighted hover state with `bg-[rgb(var(--brand-primary)/0.06)]`.
- [ ] **On drop** — file uploads immediately. Title auto-fills from filename, stripped of common suffixes:
  - File extension: `.wav`, `.mp3`, `.aif`, `.aiff`, `.flac`, `.m4a`
  - Suffixes: `_v\d+`, `_master`, `_mix`, `_final`, `_demo`, `_rough` (case-insensitive)
  - Trim leading/trailing whitespace + underscores
  - Result: `"Midnight_Drive_v3_master.wav"` → `"Midnight Drive"` (replace `_` with space).
- [ ] **Inline title rename** — click the title field on a track row to edit. Save on blur or Enter. No commit step needed.
- [ ] **Non-empty state** — pinned drop-zone strip at the top of the track list (slim, ~80px tall) + a `+ Add track` button. Both behave identically: open file picker → upload starts on selection, title auto-fills.
- [ ] **+ Add track button** opens the file picker DIRECTLY. **No more title-first form.**

### Drop-on-row gesture (Frame.io Version Stacking)
- [ ] Drop a file *onto an existing track row* → it becomes a new version of that track.
- [ ] Hover state on a row during drag-over reveals two halves:
  - **Top half** highlighted = "Replace as V<N+1>" (default, larger area).
  - **Bottom half** highlighted = "Add as separate track" (smaller area, below the row).
- [ ] Drop into empty space below the list → new track (same path as empty-state drop).
- [ ] Multi-file drop: each file becomes its own track row by default. (Stems remain zip-on-finished-version per PRD §11.4 — multi-file drop is for "I have 3 separate songs.")

### Track row anatomy
- [ ] **Hero waveform**: 320px desktop / 200px mobile, rendered for the **active** version. Reuses [`WaveformPlayer`](../../apps/web/src/components/audio/) component.
- [ ] **Version chips below waveform**: V1 · V2 · V3 (active highlighted). Click → swap waveform + comments to that version. URL reflects: `?tab=music&versionId=...`.
- [ ] **Per-version status pill in the row top-right**, bilateral copy:
  - Producer view reads: `Draft` / `Revisit` / `Final` (CSS color: muted gray / amber / brand-primary)
  - Artist view reads: `In progress` / `Needs work` / `Approved` (same colors, different copy)
  - Click → dropdown with the three options. Both producer and artist can flip. Same DB column (`track_versions.status`), different UI copy by viewer role.
- [ ] **Inline comment count + unresolved badge**.
- [ ] **3-dot menu** per track: rename track, delete track, download all versions (zip stems on the final version per §11.4).

### Component tree (new)
- [ ] [`apps/web/src/components/dashboard/project/sub-tabs/music/drop-zone.tsx`](../../apps/web/src/components/dashboard/project/sub-tabs/music/drop-zone.tsx) — empty-state full-bleed + pinned-top slim variant
- [ ] [`apps/web/src/components/dashboard/project/sub-tabs/music/track-row.tsx`](../../apps/web/src/components/dashboard/project/sub-tabs/music/track-row.tsx) — per-track row with version chips + waveform + status pill
- [ ] [`apps/web/src/components/dashboard/project/sub-tabs/music/version-status-pill.tsx`](../../apps/web/src/components/dashboard/project/sub-tabs/music/version-status-pill.tsx) — bilateral status dropdown
- [ ] [`apps/web/src/components/dashboard/project/sub-tabs/music/title-derive.ts`](../../apps/web/src/components/dashboard/project/sub-tabs/music/title-derive.ts) — pure helper for filename → title (testable in isolation)

### Existing component to rewrite
- [ ] [`apps/web/src/components/dashboard/project/sub-tabs/music-sub-tab.tsx`](../../apps/web/src/components/dashboard/project/sub-tabs/music-sub-tab.tsx) — full rewrite. Drop the title-first add-track form (lines ~455-523 in current). Drop the version-creation form (lines ~341-377). Render `<TrackRow>` per track. Wire to `projectRoom.music.useQuery` + the new mutations.

### Wiring
- [ ] Drop on empty space → `projectRoom.createTrackFromUpload({ projectId, filename, fileSize })` → returns `{ trackId, versionId, presignedMultipartInit }` → existing [`useMultipartUpload`](../../apps/web/src/components/audio/use-multipart-upload.ts) hook does the PUT-parts + completeMultipart dance. **No changes** to the upload pipeline.
- [ ] Drop on row top-half → `projectRoom.addVersionFromUpload({ trackId, filename, fileSize })`. Same upload pipeline, just doesn't create a new Track row.
- [ ] Status pill click → `projectRoom.setVersionStatus({ versionId, status })`.

### Optimistic updates
- [ ] Track creation / version creation are **optimistic** — UI shows the row immediately (with an "uploading" spinner), upload progress fills the waveform area, on completion the row swaps to the loaded waveform.
- [ ] Status pill flip is **optimistic** — the dropdown updates instantly, the mutation fires in background, on error the UI reverts + shows a toast.

### Styling
- [ ] CSS variables only (no hex / no `bg-blue-500`).
- [ ] Touch targets ≥ 44×44 on mobile.
- [ ] Animation primitives gated on `prefers-reduced-motion`.

### Tests
- [ ] `title-derive.test.ts` — pure function tests for filename → title. Cover: extension stripping, suffix stripping, multiple suffixes, edge cases (filename of just "_v3.wav" → fallback to "Untitled track").
- [ ] `drop-zone.test.tsx` — empty-state full-bleed renders; drag-over highlights; drop fires the upload action.
- [ ] `track-row.test.tsx` — version chips swap waveform; drop on top-half calls `addVersionFromUpload`; drop on bottom-half calls `createTrackFromUpload`; status pill renders with correct producer/artist copy; status flip fires the mutation.
- [ ] `version-status-pill.test.tsx` — producer viewer renders Draft/Revisit/Final; artist viewer renders In progress/Needs work/Approved; both render the same DB enum value's color.
- [ ] `music-sub-tab.test.tsx` — empty state renders drop-zone full-bleed; populated state renders pinned-top + track rows.
- [ ] `/skitza-verify` passes.
- [ ] `skitza-ux-critic` subagent review.

## Technical context

### Filename → title derivation (pure)

```ts
// apps/web/src/components/dashboard/project/sub-tabs/music/title-derive.ts
const EXTENSIONS = /\.(wav|mp3|aif|aiff|flac|m4a)$/i;
const SUFFIXES = /(_v\d+|_master|_mix|_final|_demo|_rough)$/i;

export function deriveTrackTitle(filename: string): string {
  let s = filename.replace(EXTENSIONS, "");
  // Strip suffixes iteratively (handles _v3_master, _final_v2, etc.)
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(SUFFIXES, "");
  }
  s = s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "Untitled track";
  // Title-case-ish: capitalize first letter of each word (don't lowercase
  // intentional ALL-CAPS like "OK" or acronyms).
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
```

### Drop-on-row hover state (CSS)

```css
.track-row[data-drop-active="true"] .track-row__top-half-target {
  background: rgb(var(--brand-primary) / 0.10);
  border-top: 2px dashed rgb(var(--brand-primary));
}
.track-row[data-drop-active="true"] .track-row__bottom-half-target {
  background: rgb(var(--fg-muted) / 0.06);
  border-bottom: 2px dashed rgb(var(--fg-muted));
}
```

### Reuse — no new audio infra

- [`useMultipartUpload`](../../apps/web/src/components/audio/use-multipart-upload.ts) — unchanged
- [`audio.signPart`](../../apps/web/src/server/trpc/routers/) Server Action — unchanged
- [`audio.completeMultipart`](../../apps/web/src/server/trpc/routers/) Server Action — unchanged
- [`WaveformPlayer`](../../apps/web/src/components/audio/) — reused for hero waveform
- [`PersistentPlayer`](../../apps/web/src/components/audio/persistent-player.tsx) — reused for off-tab playback continuity (S03 already preserves audio state across tab switches)

### Benchmarks

PRD §11.6 cites Frame.io (Version Stacking, status dropdown), Dropbox Replay (cross-version comments — covered in S06), Pibox (range comments — S06), BandLab (one-page-no-modals).

## TDD steps

1. **RED** — `title-derive.test.ts`. Cover 8 cases: simple `.wav`, `.mp3`, `_v3.wav`, `_master.wav`, `_v3_master.wav`, multiple `_v\d+`, edge `_v3.wav` → "Untitled track", title-case casing.
2. **GREEN** — implement `deriveTrackTitle`. Tests pass.
3. **RED** — `drop-zone.test.tsx`. Asserts empty-state full-bleed; on drag-over, hover state classes apply; on drop, `onFileSelected` callback fires with the file.
4. **GREEN** — implement `drop-zone.tsx`.
5. **RED** — `track-row.test.tsx`. Two halves on drag-over; different actions on top-half vs bottom-half drop.
6. **GREEN** — implement `track-row.tsx` + `version-status-pill.tsx`.
7. **RED** — `music-sub-tab.test.tsx`. Empty/populated rendering. Drop wires correctly.
8. **GREEN** — full rewrite of `music-sub-tab.tsx`.
9. **Manual smoke test** — start `pnpm dev`, drop a file in empty state, drop a file on a row top-half, confirm version stacking. Drop on bottom-half. Multi-file drop (3 files → 3 tracks). Flip status pill (refresh → state persists).
10. **Subagent loop** — `skitza-ux-critic`.
11. `/skitza-verify` passes.

## Test file paths

- `apps/web/src/components/dashboard/project/sub-tabs/music/__tests__/title-derive.test.ts`
- `apps/web/src/components/dashboard/project/sub-tabs/music/__tests__/drop-zone.test.tsx`
- `apps/web/src/components/dashboard/project/sub-tabs/music/__tests__/track-row.test.tsx`
- `apps/web/src/components/dashboard/project/sub-tabs/music/__tests__/version-status-pill.test.tsx`
- `apps/web/src/components/dashboard/project/sub-tabs/__tests__/music-sub-tab.test.tsx` — modify (was for old form; update for new UX)

## Definition of done

- [ ] Drop-first works at every entry point (empty state / pinned-top / + Add track)
- [ ] Drop-on-row creates versions (top-half) or new tracks (bottom-half)
- [ ] Title auto-fill matches the spec on 5 sample filenames
- [ ] Status pill bilateral copy correct on both producer + artist views
- [ ] Optimistic updates feel instant
- [ ] No upload-pipeline regressions (existing audio uploads still work end-to-end)
- [ ] `skitza-ux-critic` review clean
- [ ] `/skitza-verify` passes

## Commit message

```
feat(project-room): Music tab — drop-first uploads + version stacking

Rewrites the Music tab around drop-first UX. Kills the title-first
add-track form (the user's main complaint: "it opens me the place to
add title instead of letting me upload"). New behavior:

- Empty state: full-bleed drop zone. Drop file → upload starts
  immediately, title auto-fills from filename (strips extension +
  common suffixes _v3 / _master / _mix / _final). Inline rename on
  click.

- Non-empty state: slim pinned drop-strip + "+ Add track" button.
  Both flows are file-picker-first.

- Drop-on-row gesture (Frame.io Version Stacking): hover a track row
  during drag, see two halves — top "Replace as V<N+1>" (default),
  bottom "Add as separate track." Drop on row top-half → new version
  on existing track. Drop in empty space below list → new track.

- Multi-file drop: each file becomes its own track. Stems remain
  zip-on-finished-version per §11.4 — out-of-band from this gesture.

- Per-version bilateral status pill: producer view "Draft / Revisit
  / Final"; artist view "In progress / Needs work / Approved." Same
  DB column (track_versions.status from S01), different copy by
  viewer role. Both sides can flip.

Optimistic updates throughout: track row appears on drop, status pill
flips instantly, mutations fire in background. Toast + revert on
error.

No changes to the upload pipeline — useMultipartUpload + audio.signPart
+ completeMultipart all reused. Just the *trigger* moves from form
submit to file drop.

Story 05 of the project-room-redesign epic. Depends on S01 (status
column), S02 (mutations: createTrackFromUpload, addVersionFromUpload,
setVersionStatus), S03 (sub-tab plumbing). Blocks S06 (range comments
overlay on the same row). Reviewed by skitza-ux-critic for
Samply/Spotify-tier polish.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
