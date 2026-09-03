# Handoff — music player controls + real waveform

**Date:** 2026-09-03
**Branch:** `claude/music-player-controls-waveform-kiz99e` (pushed)
**Base:** `v3-clean` @ `712dfc9`
**Commit:** `8ee858f` — `feat(player): real waveform, song skips, repeat, shuffle and share`
**Status:** code complete, gate green, **never seen running**. The remaining work is
visual + interaction verification on a real browser.

---

## 1. What Gili asked for

From the mobile full-screen player (Hebrew song, artist view):

1. "The next song button is not next song, is next 15 seconds. It should be next song,
   and also add a 10 seconds button."
2. "You should also need there loop button and shuffle button, and a share button."
3. "The waveform should be real."

---

## 2. What was built

### Transport

- The triangle-and-bar arrows are now **Previous song** / **Next song**.
  Next disables at the end of the queue. Previous restarts the current song within its
  first 3s (`PREVIOUS_TRACK_RESTART_MS`), then steps back.
- Fine seeking moved to its own **±10 second** pair (`SEEK_STEP_MS = 10_000`), with the
  step drawn inside the icon so it can never read as a track skip again.
- Added **shuffle** and a tri-state **repeat** (off → all → one), both reporting state
  via `aria-pressed`, both persisted in `localStorage` under `skitza:playback:mode:v1`.
- Added **share**, reusing `shareNative()` and handing out the brand-canonical
  `skitza.app/...` Song page address, same as the Song page's own share control.

### Playback context (the reason "next song" was possible at all)

The player previously had no queue, so a next-song button had nothing to move to.
`PlaybackSnapshot` now carries `queue`, `loop`, `shuffle`, `shuffleOrder`.

- `playerPlay(track, { queue })` — list surfaces hand over their visible list.
  Wired in Library (grid + table) and the project page.
- A finished song now advances / wraps / repeats instead of just stopping
  (`resolveTrackEnd`).
- Media Session gets `nexttrack` / `previoustrack`, so lock-screen and headphone
  buttons work.
- The project page's existing Shuffle button now turns the _player's_ shuffle on,
  instead of shuffling exactly once.

### Real waveform

Order of preference, implemented in `MiniWaveform`:

1. `track.peaks` — pre-computed server-side at upload, shipped with the page payload.
2. A client decode of the **same-origin** audio, through a cache now **shared with the
   L3 hero waveform**, so a song drawn once is never decoded twice.
3. The seeded pseudo-envelope, only as the pre-decode placeholder.

Cross-origin audio is never fetched for decoding (no CORS grant for our origins), so
public songs depend on payload peaks — `public-song-player.tsx` now passes them.

---

## 3. Files

| File                                                         | What changed                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/audio/playback-runtime.tsx`         | Queue / loop / shuffle state, `playerNext` `playerPrevious` `playerSetLoop` `playerSetShuffle`, pure helpers (`queueNeighbors`, `playbackOrder`, `shuffledOrder`, `resolveTrackEnd`, `nextLoopMode`, `readPlaybackMode`), `peaks` on `PlayerTrack` with bounded validation (`sanitizedPeaks`), auto-advance on `ended`, Media Session prev/next |
| `apps/web/src/components/audio/persistent-player.tsx`        | New transport on desktop dock + mobile full player, `PlayerTransport` prop bag, share handler, real-peaks `MiniWaveform`, new icons (shuffle, loop, seek-10, share), helpers `shareUrlForTrack` / `loopButtonLabel` / `sameOriginPeaksUrl`                                                                                                      |
| `apps/web/src/lib/audio/use-audio-peaks.ts`                  | **New.** Shared decode hook + module cache, canonical 200-bar peaks, in-flight dedupe                                                                                                                                                                                                                                                           |
| `apps/web/src/lib/audio/rms-peaks.ts`                        | `resampleWaveformHeights` + bar-count bounds moved here so lib and component share them                                                                                                                                                                                                                                                         |
| `apps/web/src/components/audio/waveform-50.tsx`              | Decode hook extracted out; re-exports `rmsPeaks` / `resampleWaveformHeights` for existing callers. **No visual change intended.**                                                                                                                                                                                                               |
| `apps/web/src/components/music/library-screen.tsx`           | `libraryRowToPlayerTrack` + `libraryPlayQueue`, both `handlePlay` bodies collapsed onto them                                                                                                                                                                                                                                                    |
| `apps/web/src/components/music/project-page.tsx`             | `projectPlayQueue`, shuffle button turns player shuffle on                                                                                                                                                                                                                                                                                      |
| `apps/web/src/components/music/song-page.tsx`                | Ships `version.peaks` on the PlayerTrack                                                                                                                                                                                                                                                                                                        |
| `apps/web/src/components/public-song/public-song-player.tsx` | Ships `version.peaks` (only way public songs get a real waveform)                                                                                                                                                                                                                                                                               |

Tests: `__tests__/player-queue.test.ts` (new, 41), plus additions to
`persistent-player.test.ts` and `persistent-player.interaction.test.tsx`.

---

## 4. Decisions worth not undoing

- **Peaks cache is keyed by the raw URL string**, canonical at 200 bars, resampled per
  surface. `sameOriginPeaksUrl` deliberately returns the URL _unchanged_ so the dock's
  cache key matches the Song page hero's for the same track.
- **Shuffle order is stable across skips.** An early version redrew the order on every
  `set`, which let shuffled playback revisit songs and never finish the queue. The
  reducer now compares queue _ids_, not array identity. There is a regression test for
  this — do not "simplify" it back to an identity check.
- **Previous is never disabled**; at the top of a queue it restarts the song.
- **`MiniWaveform` reads `window.location.origin` in an effect, not during render**, so
  server and first client render agree. Do not inline it.
- Loop/shuffle events are not gated on `desktopAudioAllowedRef` (they are UI
  preferences, not audio access). The behavior test counts these guards — it expects 8.

---

## 5. Not done / known limits

- **Library rows carry no peaks.** Playing from the Library makes the dock decode the
  audio once to draw the real envelope. Shipping peaks in the list payload would remove
  that, at roughly 1 KB per row. Left out deliberately; ask Gili if it matters.
- **Song page has a one-song queue.** Next/previous do not walk between versions of the
  same song (that felt wrong — versions are not a playlist). Confirm with Gili.
- **The mobile mini bar was left alone** — cover, play, expand, close. It is already
  tight at 360px, so shuffle/repeat/skip were not added there. The full-screen player is
  the place for the full transport.
- **No Linear issue.** `CLAUDE.md` requires one per change under `apps/`, plus Linear's
  generated branch name, but this session was handed a fixed branch name and no matching
  issue exists in `Skitza v3`. Unresolved — raise with Gili.

---

## 6. THE TASK FOR THE NEXT SESSION — verify it visually, as a real user

Everything below is unverified by eye. The gate passed, the app was never opened.

### 6.1 How to actually see it

The app needs Clerk + Neon env to boot, so local `pnpm dev` is likely a dead end without
secrets. Two better routes:

**Route A — Vercel preview (recommended, real data).**
The branch is pushed, so a preview should exist. Run the `skitza-preview` skill to print
the URL. Signing in needs producer credentials; ask Gili if you do not have them.

**Route B — a `dev/` preview route (no auth, no database).**
`/dev/*` is **not** in the middleware's protected matcher, and `isDevGalleryAvailable()`
allows Vercel Preview + local dev. The root layout already mounts `AppMediaRuntime`
(the single `<audio>` owner) and `ToastProvider`, so a dev page only has to mount
`<PersistentPlayer />` and dispatch `playerPlay(track, { queue })`.

Copy the pattern from `apps/web/src/app/dev/sk294-offer-share/` (`page.tsx` +
`*-harness.tsx`). The harness needs:

- 3+ fake tracks with a **publicly playable audio URL** and a real `peaks` array
  (200 floats, 0..1) on at least one, and **no** peaks on another, so both waveform
  paths get looked at.
- Buttons to load the queue and to open the full-screen sheet.
- A Hebrew title on one track, RTL wrapper, to mirror Gili's screenshot.

Then push and open the preview URL. Playwright drives it: Chromium is pre-installed at
`/opt/pw-browsers/chromium`, `PLAYWRIGHT_BROWSERS_PATH` is already set, do **not** run
`playwright install`. Playwright clicks count as user gestures, so audio will actually
play.

### 6.2 Viewports to check

Per `CLAUDE.md`: verify true **390px** and **360px** widths, then desktop separately.
Do not judge phone layout from a narrow desktop window.

- iPhone-ish: 390 × 844
- Small Android: 360 × 780
- Desktop: 1440 × 900 (dock is `lg:` for the full transport)

### 6.3 Highest-risk thing to look at first: RTL

Gili's screenshot is a Hebrew song, and `MobileFullPlayer` takes `dir={direction}` from
its portal scope. The transport is a plain flex row, so **in RTL the whole row mirrors**:
shuffle lands on the right, repeat on the left, and previous/next swap sides while their
icons still point the old way.

Every major player (Spotify, Apple Music, YouTube Music) keeps transport controls LTR in
RTL locales, because the arrows encode time, not reading order. Check this on a Hebrew
track. If it mirrors, the likely fix is `dir="ltr"` on the transport rows only, leaving
title/subtitle RTL. Confirm with Gili before shipping a change of direction.

### 6.4 Layout checks (screenshot each)

Full-screen mobile player:

- [ ] The 5 main controls (shuffle, prev, play, next, repeat) fit **one row, no wrap**
      at 360px. Computed row width is ~296px inside 312px of content box — tight.
- [ ] The ±10s row sits clear of the home indicator, and the Close footer is still
      reachable.
- [ ] Artwork shrinking (`flex-1`, `min-h-0`) does not squeeze the transport off-screen
      on a short viewport. Try 360 × 640.
- [ ] The "10" inside the seek icons is legible at real device pixel ratio, and the "1"
      badge on repeat-one is legible.
- [ ] Share and expand buttons in the title row do not crowd a long Hebrew title.
- [ ] Active shuffle/repeat use `rgb(var(--brand-primary))` and read as clearly "on"
      against the dark sheet.

Desktop dock:

- [ ] 7 controls + waveform + times fit; the center column stays visually centered
      (`grid-cols-[1fr_auto_1fr]`, center `min-w-[420px]`).
- [ ] Nothing collides with the sidebar at 1024–1280px.
- [ ] Disabled Next (end of queue) is visibly disabled but not invisible.

### 6.5 Behavior checks — drive it like a user

- [ ] Play from Library → dock appears → **Next** changes the song (title + subtitle
      update), does **not** jump 15s.
- [ ] **Previous** within 3s of start → goes to the previous song. After 3s → restarts
      the current song.
- [ ] **±10s** move the clock by exactly 10 seconds and move the waveform playhead.
- [ ] Next at the end of the queue → button disabled, nothing happens.
- [ ] **Repeat all** → next at the end wraps to the first song.
- [ ] **Repeat one** → let a short song end; it restarts.
- [ ] **Shuffle on** → order changes, the currently playing song is not interrupted;
      pressing next repeatedly walks every song once without repeating.
- [ ] Reload the page → repeat and shuffle are still as you left them.
- [ ] **Share** → native sheet on a phone, "Song link copied" toast on desktop; the
      copied URL is `https://skitza.app/dashboard/music/<versionId>`.
- [ ] Let a song end naturally → the next one starts on its own.
- [ ] **Waveform is real**: open the Song page and the dock for the same song; the dock
      strip should be a squashed version of the hero waveform, not a different shape.
      Then play a different song and confirm the shape changes with it.
- [ ] Played bars fill white left-to-right as the song plays; dragging the strip scrubs.
- [ ] Lock screen / media keys: next and previous work.

### 6.6 Also confirm nothing regressed

`waveform-50.tsx` had its decode hook extracted. It should look **identical** to before.
Compare the L3 song page hero waveform against `v3-clean` on the same song.

### 6.7 Gate before any push

```
cd apps/web && pnpm typecheck && pnpm lint && pnpm test
cd packages/db && pnpm typecheck
```

Or run `$skitza-verify`. Vercel lints with `--max-warnings 0`.
Currently: 7908 passing, 98 skipped, 0 failing. Lint and typecheck clean.

---

## 7. Report back to Gili with

Screenshots at 390 and 360 (LTR and Hebrew RTL), plus desktop; a plain list of anything
that looks wrong; and the two open questions — the Linear issue, and whether Library
rows should ship peaks so the dock never has to decode.

---

## 8. VERIFICATION RESULTS — section 6 done, 2026-09-03

Driven in a real browser (Chromium, sound actually playing) at 390×844, 360×780, 360×640,
1024×800 and 1440×900, in LTR and in RTL with a Hebrew title.

**Harness:** `apps/web/src/app/dev/player-transport/` + `apps/web/public/dev-audio/`
(four generated WAVs with deliberately different envelopes — ramp / diamond / pulses / decay —
two shipping `peaks`, two forcing the client decode). Worktree `.worktrees/player-waveform`,
`DATABASE_URL` pointed at `127.0.0.1:1`, signed out. **Both are throwaway — delete before merging.**

Run it with:
`pnpm -C .worktrees/player-waveform -F web dev --port 3002` → `/dev/player-transport`

### 8.1 Confirmed working (14)

Next/previous move songs (not ±15s); previous restarts after 3s; ±10s moves exactly 10s and
clamps at both ends; Next disables at the end of the queue (white/0.2 vs white/0.55,
`cursor:not-allowed`); repeat cycles off→all→one with a "1" badge; repeat-all wraps;
repeat-one restarts a finished song; shuffle walks all 4 songs once then disables Next;
auto-advance on `ended`; share copies `https://skitza.app/dashboard/music/<versionId>` and
toasts "Song link copied"; Media Session registers `nexttrack`/`previoustrack` and metadata
follows the track; played bars fill correctly (50% → 32/64) and drag-scrub previews then commits
(50%→80% landed at 17.6s of 22s); the 5 main controls fit one row at 360px (296px inside 312px);
active shuffle/repeat render `rgb(229 163 36)` = `rgb(var(--brand-primary))`.

**The waveform is genuinely real, on both paths.** Coarse 10-bucket silhouettes matched each
source envelope, and the dock strip is the hero at lower resolution:

| track | path | silhouette (10 buckets) |
| --- | --- | --- |
| night-drive | client decode | 0.12 → 0.91 monotonic rise (ramp) |
| hebrew-stars | payload peaks | 0.14 · 0.51 · **0.99** · 0.42 · 0.22 (diamond) |
| basement | client decode | jagged comb (pulses) |
| golden-hour | payload peaks | 0.72 → 0.11 decay |

Dock strip vs L3 hero, same song: `0.12→0.91` (64 bars) vs `0.13→0.96` (201 bars).

### 8.2 Problems found (3)

1. **RTL: the transport row mirrors, icons do not.** Measured x at 390px —
   shuffle 47↔299, previous 103↔239, next 239↔103, repeat 299↔47, back/forward-10 swapped.
   Exactly the §6.3 risk. Product decision (Spotify/Apple/YouTube all keep transport LTR).

2. **RTL: waveform scrubbing is inverted.** `percentAt()` uses
   `(clientX - rect.left) / rect.width`, which is LTR-only, while the bar strip mirrors under
   `dir="rtl"`. Tapping 20% in from the left edge — visually near the *end* of the song —
   seeks to 3.6s of 18s. The picture and the touch target disagree. **This one is a real
   functional break for Hebrew users**, not a preference.

3. **Short viewports: artwork overlaps the title. NEW on this branch.** At 360×640 the artwork
   ends at 323px while the title starts at 302px — 21px overlap, artwork painted on top
   (`elementFromPoint` returns the artwork), share/expand clipped. A/B against
   `origin/v3-clean` on the same screen: **overlap 0px**. The added shuffle/repeat and ±10s rows
   are the cause. Breaks at roughly **≤650px of viewport height**; 655px and up is clear.

Minor: at 1024px the desktop transport sits 34px left of the dock's centre (0px at 1280/1440).

### 8.3 Not verified here

- **Repeat/shuffle surviving a reload.** `localStorage` is written correctly
  (`{"loop":"one","shuffle":false}`) and `restorePlaybackForAccount` applies `readPlaybackMode()`,
  but the restore only runs for a signed-in account and this harness is signed out on purpose.
  `PersistentPlayer` mounts only in `app-shell` / `artist-app-shell`, so the signed-out gap is
  unreachable in the product — but **no test covers restore applying the stored mode**.
- Native share sheet on a real phone (`navigator.share` is absent in this browser; the clipboard
  fallback was verified).
- The real Library / project page (needs auth). Wiring read in source and correct:
  `playerPlay(track, { queue: libraryPlayQueue(...) })` at library-screen.tsx:1267 and :1605,
  `projectPlayQueue()` at project-page.tsx:240, `playerSetShuffle(true)` at :262.

### 8.4 §6.6 regression check — clean

`waveform-50.tsx` is a pure extraction: `resampleWaveformHeights` moved to `~/lib/audio/rms-peaks`
byte-identical apart from the constant's name, and `WAVEFORM_MIN/MAX_BAR_COUNT` are still 24/320.
The L3 hero rendered the correct real envelope live. No visual change.

### 8.5 Gate

`pnpm typecheck` · `pnpm lint` · `pnpm test` (**7908 passed, 98 skipped, 0 failing**) ·
`packages/db pnpm typecheck` — all green, harness included.

---

## 9. GILI'S CALLS + FIXES APPLIED — 2026-09-03

**Decisions.** Hebrew is not approved and probably will not be, so the two RTL findings
(§8.2 items 1 and 2) are **left unfixed on purpose** — they are unreachable today because
`LanguageSwitcher` is deliberately not mounted (`producer-sidebar.tsx`: "intentionally NOT
imported in the rail"). Verified: a **Hebrew song title with the app in English keeps the correct
button order** (shuffle 47, previous 103, play 163, next 239, repeat 299 at 390px) — only the app
language mirrors the row. If Hebrew is ever approved, both belong to that project.

On Library peaks, Gili chose **speed**.

### 9.1 Fixed — artwork no longer covers the song title

`persistent-player.tsx`, `MobileFullPlayer` artwork: `maxHeight` `min(360px, 46vh)` →
**`min(360px, 100%)`**. A viewport fraction knows nothing about the chrome stacked below it, so
once the transport grew a shuffle/repeat row and a ±10s row the cover overflowed its
`min-h-0 flex-1` slot and painted over the title. 100% of the slot always fits.

Measured after (`--sk-layout-viewport-height` swept, 360px wide):

| viewport height | artwork | gap to title | square? |
| --- | --- | --- | --- |
| 640 | 312 × 228 | **+12px** (was −21px) | letterboxed |
| 667 | 312 × 255 | +12px | letterboxed |
| 700 | 312 × 288 | +12px | letterboxed |
| 780 | 312 × 312 | +40px | yes |
| 844 | 312 × 312 | +72px | yes |

Normal phones are byte-for-byte unchanged. Short phones letterbox the block, which is fine —
it is an `aria-hidden` decorative gradient, not a real cover image. `elementFromPoint` over the
title now returns the title, not the artwork.

Regression test: `persistent-player.interaction.test.tsx` →
"caps the artwork against its own slot, never a slice of the viewport".

### 9.2 Done — Library rows now ship their peaks

Closes the §5 known limit. Playing from the Library no longer costs a fetch + Web Audio decode
before the strip shows the real envelope.

- `music-read-model.ts` — `peaks` added to `MusicLatestVersion`, selected from
  `trackVersions.peaks`, mapped as `version.peaks ?? null`.
- `library-screen.tsx` — `peaks?: number[] | null` on `MusicLibraryTrackRow`;
  `libraryRowToPlayerTrack` spreads it only when non-empty (`exactOptionalPropertyTypes`).
- `(producer)/dashboard/music/page.tsx` and `(artist)/artist/music/page.tsx` pass it through.

Cost: peaks persist rounded to **4 decimals** (`roundPeaks`, default 4), so ≈**1.3 KB raw per
song** — ~65 KB raw on a 50-song Music page, appreciably less over the wire once compressed.

Regression tests: `library-play-queue.test.ts` (5) — peaks reach the player, are omitted when
null or empty, work for artist rows, and survive onto every queue entry rather than only the
clicked row.

### 9.3 Still open

- **No Linear issue** for this branch (unchanged).
- Nothing committed or pushed.
- Harness `apps/web/src/app/dev/player-transport/` + `apps/web/public/dev-audio/` (3.7 MB of
  WAVs) are still present and untracked. **Delete both before merging** — and never `git add -A`
  here.
