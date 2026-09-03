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
