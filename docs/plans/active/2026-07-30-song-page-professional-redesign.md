# Song Page professional redesign — approved plan

**Date:** 2026-07-30
**Status:** Approved by Gili; implementation in progress under SK-151
**Surface:** Authenticated individual Song Page for producers and artists

## Goal

Redesign the individual Song Page so it feels like a serious, high-end studio
workspace with a small amount of premium music-player character. Mobile must be
a purpose-built player experience, not a compressed desktop page.

## Exact scope

This plan covers the shared individual playback-and-notes page:

- Producer: `/dashboard/music/[versionId]`
- Artist: `/artist/music/song/[versionId]`
- Shared component: `apps/web/src/components/music/song-page.tsx`

This plan does not cover:

- Clients & Projects Song Space
- The public storefront
- Anonymous song-sharing pages
- A song queue or previous/next-song playback

## Shared product direction

- Producers and artists use the same visual layout.
- Both roles see the artwork, player, waveform, versions, and notes.
- Role-specific workflow controls keep the current paid-workflow rules:
  producers mark an exact version ready and verified artists approve it.
- Artists do not see producer-only project controls.
- The project name is the link back to the Music project page. Remove the
  separate “Open in project room” button.

## Desktop experience

- Use a fixed professional workspace below the app navigation.
- Split the main area roughly 65/35:
  - Left: song information, artwork, waveform, and playback.
  - Right: an always-visible Notes panel.
- The Notes list scrolls inside its panel while the player remains visible.
- Use a warm, light workspace with a dark listening canvas.
- Replace the large colorful hero with a compact header.
- Show optional artwork at about 120–140px.
- Show the song title with a restrained display treatment.
- Present artist/client, project, version, approval state, duration, and upload
  date as quiet text—not a collection of badges.
- Remove the uppercase “SONG” label, glossy decoration, and random gradients.
- Keep the version control compact. Opening it shows complete version history.
- Give the real waveform substantially more space.
- Put 15 seconds back, Play/Pause, 15 seconds forward, time, and volume directly
  below the waveform.
- Do not duplicate Play in the header.
- Hide the global mini-player while this full player is visible without
  stopping playback.
- Use a compact review timeline with thin dividers instead of rounded chat
  cards. Keep the composer pinned at the bottom.
- Amber waveform markers are open notes; grey markers are resolved notes.
- Tapping a note or marker jumps to its timestamp and starts playback.

## Mobile and tablet experience

- Below 1024px, use a dedicated full-dark player-first layout.
- The top bar contains Back, the small project name, and More.
- Show large square artwork, almost the width of a phone.
- At 390px, target roughly 342px artwork with comfortable side margins.
- Below the artwork show song details, compact version control, waveform,
  15-second transport controls, and a prominent Notes button.
- Notes open in a full-height sheet with a compact player at the top and a
  pinned composer at the bottom.
- Closing Notes preserves unfinished note text.
- Verify at true 390px and 360px widths.

## Artwork

- Artwork is optional per song.
- Producers change it from `More → Change cover`.
- Artists can view it but cannot change it.
- Store artwork privately and deliver it through an authenticated same-origin
  route.
- When no artwork exists, show a restrained, neutral, title-based cover.

## Version behavior

- Replace visible version pills with one compact version control.
- Desktop opens a small menu; mobile opens a bottom sheet.
- Version history shows label, upload date, duration, and workflow state.
- If this song is loaded in the player, changing versions preserves timestamp
  and playing/paused state. It must not hijack unrelated playback.

## Existing behavior to preserve

- Notes belong to one specific song version and sort by song time.
- Resolved notes remain visible in grey and move to the bottom.
- Users can hide or show resolved notes.
- Focusing the composer pauses playback.
- Posting or leaving the composer resumes playback when this page paused it.
- A posted note uses the current playback timestamp.
- Versions remain newest-first.
- Playback continues across navigation.
- All mobile controls meet the 44px touch-target floor.
- Producer and artist access guards remain unchanged.
- Download, public-link, delivery, archive, release, rename, delete-audio, and
  paid-workflow behavior remains available.

## Implementation visual brief

### Palette

- **Oat Canvas — `#F2EDE6`:** main desktop background
- **Paper — `#FFFFFF`:** notes and utility surfaces
- **Studio Ink — `#111009`:** primary type and mobile listening background
- **Studio Panel — `#1C1A14`:** desktop listening desk
- **Signal Amber — `#D4960A`:** play progress, open note markers, focus
- **Approval Green — `#0F6932`:** exact approved state only

Existing product tokens provide these colors; implementations use
`rgb(var(--token))` where a token exists.

### Type

- Outfit: body, controls, and notes
- Syne: restrained song title only
- JetBrains Mono: timestamps, duration, and version data only

### Structure

Desktop:

```text
┌ artwork │ title · project · version                 state · more ┐
├──────────────────── dark listening desk ───────┬──── Notes ─────┤
│                                                │ filter          │
│          precise waveform + markers            │ timeline        │
│       −15    PLAY    +15    time    volume      │                 │
│                                                │ composer pinned │
└────────────────────────────────────────────────┴─────────────────┘
```

Mobile/tablet:

```text
back                 project                 more
                 [ large artwork ]
                title / artist
                   version
             waveform + markers
              current / duration
             −15   PLAY   +15
                 Notes (count)
```

The Notes sheet replaces the large artwork with a compact player row.

### Signature element and critique

The precise waveform and timestamp-note rail—not the cover—is the memorable,
music-specific element. Warm cream can feel generic by itself, so the dark
listening desk and exact waveform carry the identity. The design intentionally
rejects glossy gradients, glass, glow, animated reveals, excessive pills, and
decorative hero art.

## Acceptance checklist

### Desktop

- Compact header; no full-bleed decorative hero.
- Player and Notes use the agreed 65/35 workspace.
- Waveform and Notes remain visible together.
- No duplicate Play control or duplicate mini-player.
- Project navigation works through the project name.

### Mobile and tablet

- Purpose-built player layout is active below 1024px.
- True 390px and 360px layouts have no horizontal overflow.
- Large artwork, waveform, and controls fit without feeling crowded.
- Notes sheet keeps a compact player visible.
- Closing and reopening Notes preserves the draft.
- Every interactive control has a comfortable touch target.

### Shared behavior

- Producer and artist layouts match apart from role-specific actions.
- A version switch preserves time and playing/paused state.
- A note or marker jumps to the correct time and plays.
- Current producer-ready and artist-approval semantics remain correct.
- Artwork upload and the neutral fallback both work.
- Existing comment, playback, download, and access-control tests remain green.

## Execution

1. Linear issue: SK-151, moved to In Progress.
2. Branch: `giasraf/sk-151-redesign-shared-song-page-as-a-professional-desktop-and`.
3. Base/target: `v3-clean`.
4. Run `$skitza-verify` before claiming verification.
5. Visually verify desktop plus true 390px and 360px mobile layouts.
