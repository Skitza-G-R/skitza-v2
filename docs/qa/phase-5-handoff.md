# Phase 5 — Artist platform pages handoff

**Status:** ✅ **All work shipped on `phase-5-artist`** (6 commits ahead of `v3-clean`).
**Source branch:** `phase-5-artist`
**Base:** `v3-clean`
**Branched at:** `53b9c81` (post Phase 1 + Phase 2 merge)
**Rebased at:** `deb8d76` (post Phase 4 Sheet primitive merge — PR #57)
**Author:** Gili (with Claude Code)
**Approver:** Raz (technical co-founder)
**Scope:** Artist platform — 5 routes × mobile + desktop, plus the persistent mini-player, plus 2 new primitives (Tooltip, Dropdown Menu).

This document records every decision made during Phase 5 so the next phase (or a fresh session resuming this work) can pick up cleanly.

---

## Final state on `phase-5-artist`

```
e7d9be7 feat(artist): phase 5 — Booking flow redesign (mobile + desktop)
07e1ea8 feat(artist): phase 5 — Song page redesign (mobile + desktop)
236aa48 feat(artist): phase 5 — PersistentMiniPlayer re-skin (in place)
2a8a1e4 feat(artist): phase 5 — Music library, Store, Settings (mobile + desktop)
249e178 feat(artist): phase 5 — Home redesign (mobile + desktop)
eaf7e40 feat(ui): phase 5 — Tooltip + Dropdown Menu primitives
─────────────── (rebase boundary)
deb8d76 Merge pull request #57 from Skitza-G-R/phase-4-producer  ← Sheet primitive
c535292 feat(ui): sheet primitive
53b9c81 docs(ui): phase 3-4-5 parallel briefs + cross-cutting decisions
```

### Verification (post-rebase, 2026-05-05)

```
$ pnpm typecheck
packages/db typecheck: Done
apps/web typecheck: Done

$ pnpm lint
apps/web lint: Done

$ pnpm -F web test
 Test Files  95 passed | 1 skipped (96)
      Tests  1003 passed | 4 skipped (1007)
   Duration  3.62s
```

Baseline before Phase 5 was **986 tests / 4 skipped**. Phase 5 added **+10** tests (the `producer-color` helper unit suite); the remaining +7 came from Phase 4's Sheet PR.

---

## Inputs

The locked Phase 5 source — `~/Downloads/skitza (1)/`:

- `notes/skitza-context.txt`, `notes/design-system.md` — locked palette + typography + motion (no changes from Phase 1/2).
- `screens/home.jsx` — artist home mobile (hero + Next session + Latest mix + Balance + Activity).
- `screens/music.jsx` — Music library + Song Page (L3 with waveform + comments + slide-up modal composer).
- `screens/book.jsx` — booking 5-step state machine (picker → calendar → product → confirm → pending).
- `screens/store-settings.jsx` — Store catalog + Settings + ApprovalMirror overlay (deferred — see below).
- `screens/booking-artboards.jsx` — 4 standalone iPhone artboards for the polished 3-step variant + edge states.
- `screens.artist-desktop-1.jsx`, `screens.artist-desktop-2.jsx` — desktop tree (Home / Music / Book / Store / Messages / Settings).
- `data.artist.jsx` — fixture-only helpers; reference for `skGradient` (deterministic name → hue).

---

## Decisions

### 1. Two new deferred primitives shipped — Tooltip + Dropdown Menu

Phase 5 owns these per cross-cutting decisions in `phase-3-4-5-briefs.md`. Phase 4 owned Sheet (shipped first as PR #57 → `deb8d76`).

| Primitive | File | Backed by | Tokens |
|---|---|---|---|
| **Tooltip** | `apps/web/src/components/ui/tooltip.tsx` | `@radix-ui/react-tooltip` | `bg-sidebar` surface + `fg-inverse` text + `radius-sm` |
| **Dropdown Menu** | `apps/web/src/components/ui/dropdown-menu.tsx` | `@radix-ui/react-dropdown-menu` | `bg-elevated` + `border-subtle` + `--shadow-md` + `sk-pop` mount |

New deps: **`@radix-ui/react-tooltip ^1.1`**, **`@radix-ui/react-dropdown-menu ^2.1`**. Approved per Raz.

New motion class: `.sk-tooltip-enter` (100ms fade + 2px slide). Defined in `globals.css`, gated in the `prefers-reduced-motion: reduce` block alongside `.sk-dialog-enter`, `.sk-sheet-enter`, and `.sk-toast-in`.

### 2. Producer color helper — deterministic hue from name

`apps/web/src/lib/artist/producer-color.ts` exports three pure helpers:

- `producerHue(name: string): number` — FNV-1a-ish hash → `[0, 360)` hue.
- `producerInitials(name: string): string` — first chars of first two words, fallback "??".
- `producerGradient(name: string): string` — locked CSS string `linear-gradient(135deg, oklch(0.72 0.13 H), oklch(0.45 0.14 H+30))`.

10 unit tests pin determinism and edge cases (empty string, single word, multi-whitespace, single character).

**Why a helper, not a tRPC field:** the artist tRPC shapes (`artist.home`, `artist.music.projects`, `artist.store.products`) carry only `producerName` strings. Adding a `producerHue` schema column would have been out-of-scope (no tRPC changes per brief). Hashing the name client-or-server-side gives deterministic, schema-free per-producer color.

`apps/web/src/components/artist/producer-avatar.tsx` consumes the helpers as a server-renderable atom. Used everywhere a producer needs visual identity (home, music, store, book, settings, mini-player, song page).

### 3. Out-of-scope: Messages screen

The desktop design source includes a 6th screen (`MessagesScreenDesktop`) with thread list + chat bubble pane + composer. **No corresponding route exists in the app** (`/artist/messages` is not in the brief's 5-route scope, and there's no tRPC procedure backing it).

**Decision:** Skip Messages entirely. Building dead screens = waste. Add a follow-up task when threading lands as a real product feature.

### 4. Out-of-scope: ApprovalMirror overlay

The mobile booking design (`screens/store-settings.jsx`) includes a full-screen overlay shown post-booking that previews the producer-side approval card.

**Decision:** Skip. Producer-side preview shown to artist post-booking = confusing UX, low value. Defer.

### 5. Modal architecture for booking — Dialog only

The brief mentioned **"Sheet for mobile, Dialog for desktop centered modal"** for the booking flow. Implementation notes:

- **Sheet** (Phase 4) is designed for *persistent surfaces* (drag-handle bottom-sheet pattern; the handle is decorative — Sheet doesn't actually let you drag-to-dismiss, but the visual cue implies "this surface stays open while you work").
- **Dialog** (Phase 1) is *responsive*: bottom-sheet on mobile (<640px) + centered modal on desktop (≥640px). Designed for action-and-dismiss flows.

Booking is action-and-dismiss (pick a slot → confirm → close). Using both Sheet (mobile) and Dialog (desktop) would have required dual mounts with focus-trap conflicts (two Radix Roots open at once with one display-hidden) OR a client-side `useMediaQuery` hook (SSR-unfriendly).

**Decision:** Use Dialog at both viewports. Mobile gets bottom-sheet (no drag handle, but otherwise visually identical to a Sheet bottom-sheet); desktop gets centered modal. Sheet stays available for the song-page comment composer, which IS a persistent surface (stays open while user scrolls comments).

### 6. Song page composer — Sheet (mobile) + inline panel (desktop)

The song page comment composer uses Phase 4's Sheet primitive on mobile (`<lg`) and an inline panel on desktop (`lg+`). State lives in `useArtistAudio()` — single source of truth. Both surfaces gate on `audio.state.pendingComment !== null`.

This dual-surface pattern works here (vs. booking) because:
- The song page has no focus-trap conflict — the inline desktop panel is just JSX, not a Radix Root.
- The composer IS a persistent surface (stays open while user reads comments below) — Sheet's mental model fits.

### 7. WaveformPlayer wrapping — preserved API, two heights

The locked design specifies different waveform heights per viewport:
- **Mobile:** 70px (focused, fits in the dark hero card)
- **Desktop:** 84px (more breathing room in the Samply-style detail pane)

Implemented as two `<WaveformPlayer>` instances (one `lg:hidden` at h=70, one `hidden lg:block` at h=84), both passed the same `ref` for the imperative pause-on-focus handle. Phase 4's WaveformPlayer extension (un-merged at the time of writing) is additive (more callbacks/event hooks); when it lands, the two instances slide together at merge time.

**Did NOT touch:** `apps/web/src/components/audio/waveform-player.tsx`, `ArtistAudioProvider`, `skitza:player:*` event bus, `<audio>` element wiring, `now-playing.tsx`'s `submitTimestampedComment` server action.

### 8. PersistentMiniPlayer re-skin in place

Per Strategic Lead coordination: the audio provider, the `<audio>` element, the singleton lifecycle, and the now-playing.tsx server component stay BYTE-IDENTICAL. Only the visible chrome changed:

- Dark `--bg-sidebar` rail (mini-player now reads as chrome, not card).
- 40px gradient album-art tile (producer hue from `producer-color`) when artworkUrl is null.
- Amber 44px play/pause button.
- 3px amber progress bar pinned to the bottom edge, driven by the existing reducer's `position` + `duration` (no extra state).
- 3-bar eq visualizer (existing `.eq-bar` keyframe) when playing.
- Mobile: full-width fixed dock above the 56px BottomNav.
- Desktop (lg+): floats bottom-right of the main column with `lg:left-[calc(248px+1rem)]` so it sits clear of the 248px artist desktop sidebar.

### 9. Status line composition (Home)

The home page's hero status line ("3 new mixes · session tomorrow", or "All quiet.") is composed from existing data:
- `recentUploads` count = `activity.filter(a => a.kind === "track_uploaded").length`
- `nextSession` relative-day = today / tomorrow / `weekday` / `Mon DD`

No new tRPC fields required.

### 10. Active projects + recent uploads on desktop home

Desktop home left column shows:
- **Active projects** rich rows (gradient avatar + title + producer + track count + latest-track preview). Sourced from the existing `artist.music.projects` procedure (the same one the music tab uses) — added as a parallel Promise.all in `(artist)/artist/page.tsx`.
- **Recent uploads** list — distilled from `home.activity.filter(kind==='track_uploaded')`.

Per-project balance + paid-% progress bar from the design source is **deferred** — the existing tRPC shape doesn't carry it. Adding would have been a schema change (out-of-scope for Phase 5).

### 11. 4-stat row — "Open notes" → "Recent mixes"

Design source labels the second stat "Open notes" (count of comments awaiting reply). The existing tRPC shape doesn't expose comment counts on the home payload, so the stat is repurposed to **"Recent mixes (last 7 days)"** — a count of `track_uploaded` activity events. Same data, slightly different framing.

### 12. Settings — desktop section nav deferred

Design source desktop Settings has a 220px sticky section nav (Profile / Notifications / Payments / My studio / Security) with content panels per section. Phase 5 ships a flat list (Account → Connected producers → Integrations → version footer) at both viewports. The flat list works well at both widths today.

A follow-up PR can add the section nav + content panels when the Settings route gains more depth (e.g. when payment method connection actually wires through).

### 13. Music library — single-pane list at both widths

Design source desktop Music has a 380px left rail with track filter chips + scrollable track list, plus a right-pane song detail (waveform + comments). Phase 5 ships a single-pane list at both widths.

**Why deferred:** the right-pane song detail needs Sheet for the comment composer, which IS available now — but the existing app routes `/artist/music/[projectId]` to a focused detail page (rendered by Song page commit `07e1ea8`), not a side-by-side rail/pane. Splitting the music library into a master/detail layout would be a structural refactor of routing — out of Phase 5's "redesign existing routes" scope.

When the master/detail split makes product sense, the song page card built in Phase 5 drops in as the right-pane content unchanged.

### 14. Producer-filter avatar carousel — deferred

The mobile design's Music library has a horizontal scrollable carousel of producer avatars for filtering tracks by producer. Skipped because the existing `artist.music.projects` shape doesn't carry a `producerId` (only `producerName`) — a filter UI couldn't round-trip the selection. Hooks in cleanly when the schema gains a producerId column.

---

## Files added

| File | Purpose |
|---|---|
| `apps/web/src/components/ui/tooltip.tsx` | Tooltip primitive (Radix) |
| `apps/web/src/components/ui/dropdown-menu.tsx` | Dropdown Menu primitive (Radix) |
| `apps/web/src/lib/artist/producer-color.ts` | Deterministic name → hue/initials/gradient |
| `apps/web/src/lib/artist/__tests__/producer-color.test.ts` | 10 unit tests |
| `apps/web/src/components/artist/producer-avatar.tsx` | Gradient monogram tile (server-renderable) |
| `apps/web/src/components/artist/home/page-hero.tsx` | Hero with date + Syne greeting + status line |
| `apps/web/src/components/artist/home/decorative-waveform.tsx` | 50-bar SVG silhouette (NOT real waveform) |
| `apps/web/src/components/artist/home/stat-card.tsx` | Desktop stat tile |
| `apps/web/src/components/artist/home/active-projects-card.tsx` | Desktop left-column projects |
| `apps/web/src/components/artist/home/recent-uploads-card.tsx` | Desktop left-column uploads list |

## Files modified

| File | Change |
|---|---|
| `apps/web/package.json` | +2 deps (Radix tooltip + dropdown-menu) |
| `apps/web/src/app/globals.css` | +1 keyframe + +1 motion class + +1 reduce-gate entry |
| `apps/web/src/app/(artist)/artist/page.tsx` | Mobile + desktop home layouts, Clerk currentUser() greeting |
| `apps/web/src/app/(artist)/artist/music/page.tsx` | Hero + project list (mobile + desktop) |
| `apps/web/src/app/(artist)/artist/music/[projectId]/now-playing.tsx` | Full visual rewrite — dark hero + waveform card + Sheet composer |
| `apps/web/src/app/(artist)/artist/store/page.tsx` | Hero + producer carousel + product grid |
| `apps/web/src/app/(artist)/artist/settings/page.tsx` | Hero + Account + Connected producers + Integrations |
| `apps/web/src/app/(artist)/artist/book/booking-client.tsx` | Hero + 14-day strip + Dialog modal with progress bar |
| `apps/web/src/components/artist/persistent-mini-player.tsx` | Re-skin in place (audio plumbing preserved) |
| `apps/web/src/components/artist/producer-picker.tsx` | Re-skin with ProducerAvatar gradients |
| `apps/web/src/components/artist/music/project-card.tsx` | Rich row with gradient avatar + producer chip |
| `apps/web/src/components/artist/store/product-card.tsx` | Title + tagline + price + pricing-model pill |
| `apps/web/src/components/artist/home/next-session-card.tsx` | Date block + producer chip + dark CTA |
| `apps/web/src/components/artist/home/latest-mix-card.tsx` | Gradient play btn + decorative waveform |
| `apps/web/src/components/artist/home/upcoming-sessions-card.tsx` | Date pill rows + raw/card variants |
| `apps/web/src/components/artist/home/balance-card.tsx` | Quiet single-line + amber Pay pill |
| `apps/web/src/components/artist/home/activity-feed.tsx` | Avatar rows + raw/card variants |

## Files deleted

None. Phase 5 is in-place re-skin everywhere.

---

## Out-of-scope discipline (verified)

```
$ git diff --name-only v3-clean..HEAD | grep -v -E '(\(artist\)|components/artist|components/ui|lib/artist|globals\.css|package\.json|pnpm-lock|docs/qa)'
(empty)
```

- **Zero changes** under `apps/web/src/server/`.
- **Zero changes** under `packages/db/`.
- **Zero changes** under `apps/web/src/app/(producer)/`, `(public)/`, `(onboarding)/`, `(auth)/`.
- **Zero changes** to existing artist tRPC routers (`artist.home`, `artist.music.*`, `artist.book.*`, `artist.store.*`, `artist.studios`).
- **Zero changes** to `ArtistAudioProvider`, `WaveformPlayer`, `<audio>` wiring.
- **Existing primitives** (Phase 1 Button, Card, Input, Dialog, EmptyState, toast) — untouched.

---

## Cross-phase coordination

### Phase 4 shared utils (un-merged at time of writing)

Phase 4 reportedly extended `WaveformPlayer` and shipped shared utils (`hueFor`, `Avatar`, `fmtMoney`). Phase 4's main PR has not yet landed on `v3-clean`, so Phase 5 built parallel implementations:

| Phase 5 | Phase 4 (un-merged) |
|---|---|
| `producerHue()` in `lib/artist/producer-color.ts` | `hueFor()` (location TBD) |
| `<ProducerAvatar>` in `components/artist/` | `<Avatar>` (location TBD) |
| Inline `formatMoney` / `fmtMoney` in several files | `fmtMoney` shared util |

**Follow-up consolidation:** when Phase 4 merges, open a small docs/refactor PR that:
1. Identifies whether Phase 5's `producerHue` matches Phase 4's `hueFor` semantically (deterministic, same hash function family). If yes, alias one to the other; if no, document the divergence.
2. Choose one Avatar component (`<Avatar>` is more generic; `<ProducerAvatar>` is more specific). Migrate call-sites to the chosen one.
3. Replace inline money formatters with shared `fmtMoney`.

This is a single follow-up PR, not blocking Phase 5 merge.

---

## Pending — manual screenshots (Gili / Raz)

Phase 5 brief requires **12+ screenshots minimum**: each of the 5 routes × mobile + desktop, plus song page mobile + desktop separately. Claude's preview pane cannot follow Clerk auth redirects (per Phase 3-4-5 brief), so screenshots have to come from a real browser.

**Routes to capture** (sign in as a real artist account, then visit at both 375px mobile DevTools + 1280px desktop):

1. `/artist` — mobile + desktop home
2. `/artist/music` — library list mobile + desktop
3. `/artist/music/<projectId>` — song page mobile + desktop (the most complex screen)
4. `/artist/book` — mobile + desktop landing
5. `/artist/book` with a slot tapped — mobile bottom-sheet + desktop centered modal
6. `/artist/store` — mobile + desktop
7. `/artist/settings` — mobile + desktop

Save under `docs/qa/phase-5-artist/<route>-<width>.png` per the Phase 1 precedent.

---

## Pre-flight before merge

- [x] Phase 4 PR #57 (Sheet primitive) merged at `deb8d76`
- [x] `phase-5-artist` rebased on latest `v3-clean`
- [x] `pnpm typecheck` clean
- [x] `pnpm lint` clean
- [x] `pnpm -F web test` — 1003 passed / 4 skipped
- [x] `phase-5-artist` pushed to origin
- [ ] Manual screenshots captured (Gili in real browser)
- [ ] Vercel preview spot-checked (Raz)
- [ ] Open PR `chore(ui): phase 5 — artist pages`, base `v3-clean`

When Phase 4's main PR merges, rebase once more on the new `v3-clean` and run the consolidation follow-up (above) as a separate PR.

---

*Last updated: 2026-05-05*
