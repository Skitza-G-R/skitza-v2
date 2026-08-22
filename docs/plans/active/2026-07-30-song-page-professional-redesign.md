# Song Page professional redesign — approved plan

**Date:** 2026-07-30  
**Status:** Direction approved by Gili; implementation has not started  
**Surface:** Authenticated individual Song Page for producers and artists

## Goal

Redesign the individual Song Page so it feels like a serious, high-end studio
workspace with a small amount of premium music-player character. Mobile must be
a purpose-built player experience, not a compressed desktop page.

## Exact scope

This plan covers the shared individual playback-and-notes page:

- Producer: `/dashboard/music/[versionId]`
- Artist: `/artist/music/song/[versionId]`
- Shared component today: `apps/web/src/components/music/song-page.tsx`

This plan does not cover:

- Clients & Projects Song Space
- The public storefront
- Anonymous song-sharing pages
- A song queue or previous/next-song playback

## Shared product direction

- Producers and artists use the same visual layout.
- Both roles see the artwork, player, waveform, versions, and notes.
- Producers also see Approve and Change cover controls.
- Artists do not see producer-only project controls.
- The project name is the link back to the project. Remove the separate
  “Open in project room” button.

## Desktop experience

### Layout

- Use a fixed professional workspace below the app navigation.
- Split the main area roughly 65/35:
  - Left: song information, artwork, waveform, and playback.
  - Right: an always-visible Notes panel.
- The Notes list scrolls inside its panel while the player remains visible.
- Use a warm, light workspace with a dark listening canvas.

### Header

- Replace the large colorful hero with a compact header.
- Show optional artwork at about 120–140px.
- Show the song title with a restrained display treatment.
- Present artist/client, project, version, approval state, duration, and upload
  date as quiet text—not a collection of badges.
- Remove the uppercase “SONG” label, glossy decoration, and random gradients.
- Keep the version control compact: for example, `Version 4 · Current`.
  Opening it shows the complete version history.

### Player

- Give the real waveform substantially more space.
- Use a precise studio waveform with calm played/unplayed contrast.
- Put the transport directly below the waveform:
  - 15 seconds back
  - Play/Pause
  - 15 seconds forward
  - Current time and total duration
  - Volume
- Do not duplicate Play in the header.
- Hide the global mini-player while this full Song Page player is visible.
  Playback continues, and the mini-player returns after navigating away.

### Notes

- Use a compact review timeline with thin dividers instead of separate rounded
  cards or chat bubbles.
- Each note shows the author, song timestamp, note text, and quiet actions.
- Keep the note composer pinned at the bottom of the panel.
- Use small waveform markers:
  - Amber for open notes
  - Grey for resolved notes
- Tapping a note or marker jumps to its timestamp and starts playback there.

## Mobile and tablet experience

### Layout

- Use the dedicated player-first layout below 1024px.
- This includes phones and an iPad held upright.
- Use a full dark player surface.
- The top bar contains:
  - Back
  - Small project name
  - More
- Do not show desktop breadcrumbs.

### Main player

- Show large square artwork, almost the width of the phone.
- At 390px, target roughly 342px artwork with comfortable side margins.
- Below the artwork, show:
  - Song title and artist/client
  - Compact version control
  - Precise mobile waveform
  - 15 seconds back
  - Large Play/Pause
  - 15 seconds forward
  - A prominent Notes button
- The mobile layout must be verified at true 390px and 360px widths.

### Notes sheet

- Notes open in a full-height sheet.
- The large player becomes a compact player bar at the top of the sheet.
- The composer stays pinned at the bottom.
- Users can close Notes with a down control or a swipe.
- Preserve unfinished note text if the sheet closes.

## Artwork

- Artwork is optional per song.
- Producers change it from `More → Change cover`.
- Artists can view it but cannot change it.
- When no artwork exists, show a restrained, neutral, title-based cover.
- Do not use a glossy fake album tile or a bright random gradient as the
  fallback.
- Execution will require an optional per-song artwork field and an R2 upload
  path. The implementation issue must define the migration and upload details.

## Version behavior

- Replace visible version-pill collections with one compact version control.
- Desktop opens a small menu; mobile opens a bottom sheet.
- Version history shows label, upload date, duration, and approval state.
- When changing versions, keep the same timestamp and playback state:
  - V3 playing at `1:20` switches to V4 playing at `1:20`.
  - V3 paused at `1:20` switches to V4 paused at `1:20`.

## Actions

### Always visible

- Play/Pause
- Approve for producers only

### More menu

- Share
- Download
- Change cover for producers
- Undo approval after a version is approved

Remove Favorite until it has real saved behavior. The current local-only
Favorite resets after navigation and must not remain in the redesigned page.

Approval is one click with no confirmation dialog. After approval, show a quiet
green `Approved` state and move Undo into More.

## Visual system

- Use a clean sans-serif hierarchy.
- Reserve the display font for a restrained song title.
- Use monospace only for timestamps and version data.
- Use 8–12px corners, flat surfaces, and thin borders.
- Reserve circles for Play and icon-only controls.
- Use amber only for active playback and open-note markers.
- Use soft green only for Approved.
- Use red only for errors.
- Keep all other surfaces neutral.
- Use functional motion only for sheets, menus, player changes, and state
  transitions.
- Remove:
  - Random client-colored hero gradients
  - Glass layers and nested bezels
  - Glow and pulse effects
  - Staggered entrance animations
  - Hover-lifting cards
  - Excessive pills and tiny uppercase labels
  - Cartoon, confetti, or cute empty-state illustrations

## Existing behavior to preserve

- Notes belong to one specific song version.
- Notes are ordered by their time in the song.
- Resolved notes remain visible in grey and move to the bottom.
- Users can hide or show resolved notes.
- Focusing the composer pauses playback.
- Posting or leaving the composer resumes playback when the page paused it.
- A posted note uses the current playback timestamp.
- Versions remain newest-first.
- Playback continues across navigation.
- All mobile controls meet the 44px touch-target floor.
- Producer and artist access guards remain unchanged.

## Empty and loading states

- Use calm, direct text and one clear action.
- Example: `No notes yet. Add one at the current time.`
- Do not use large illustrations or decorative celebration effects.

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
- Approval and Undo behave as specified.
- Artwork upload and the neutral fallback both work.
- Existing comment, playback, download, and access-control tests remain green.

## Execution gate

Before implementation:

1. Create or select the matching issue in Linear project `Skitza v3`.
2. Read the full issue and move it to `In Progress`.
3. Branch from `v3-clean` using Linear’s exact generated branch name.
4. Keep implementation limited to this plan.
5. Run `$skitza-verify` before claiming verification or opening a PR.
6. Visually verify desktop plus true 390px and 360px mobile layouts.

