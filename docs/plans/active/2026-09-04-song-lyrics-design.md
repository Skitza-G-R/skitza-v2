# Song lyrics — design

Date: 2026-09-04
Status: approved by Gili, not yet built

## What we are building

A song can carry its words. Two ways in:

1. A visible **Lyrics** field in the Upload new Version modal.
2. A full-width **Lyrics** row on the song page, right under the player, that opens a
   popup where the words can be read and rewritten.

## Decisions Gili made

| Question | Answer |
| --- | --- |
| Song-level or version-level? | **One set per song.** V1/V2/V3 share it. |
| Who can edit? | **Producer and artist both.** Guests on a public link see nothing. |
| Two people edit at once? | **Block the second save and warn**, with a "save mine anyway" escape. |
| Length cap | **8,000 characters.** |

## Why lyrics are song-level

The producer's mental model is "the words of this song", not "the words of V2". A single
sheet means fixing a typo fixes it everywhere, and the artist never sees two different
sets of words depending on which version they opened.

## Data

Three new columns on `project_tracks` (the song row), migration `0062`.
`0061` is already claimed by the open SK-302 PR (#418) — do not reuse it.

| Column | Type | Why |
| --- | --- | --- |
| `lyrics` | `text` null | the words |
| `lyrics_updated_at` | `timestamptz` null | powers "Updated 3 days ago" **and** the clash guard |
| `lyrics_updated_by` | `text` null, `'producer' \| 'artist'` | so the line reads "by you" or "by <artist>" |

Shape CHECK: the two stamps are either both null or both set; `lyrics IS NOT NULL`
requires both stamps set. A cleared sheet keeps its stamps (we still know who cleared it).

Storing the **role** rather than a user id is deliberate: a producer lives in `producers`
and an artist in `client_contacts`, so a single foreign key cannot cover both. The reader's
own page already knows the other side's display name, so role + timestamp renders the full
sentence with no extra join.

## Clash guard

Optimistic concurrency, no locks and no polling:

1. The page hands the client the `lyrics_updated_at` it loaded.
2. Saving sends that value back.
3. The UPDATE carries `WHERE lyrics_updated_at IS NOT DISTINCT FROM :expected`.
4. Zero rows updated means somebody else saved first — return a typed
   `STALE` result carrying the current lyrics, stamp and role.
5. The popup shows the amber bar. The typed text is never cleared.
   "Save mine anyway" re-sends with the fresh stamp.

## Upload path

Lyrics are saved by a **separate call after** the version upload completes. They are never
added to the version-completion payload.

`first-version-upload.ts` is a guarded state machine — write-once tokens, compare-and-set
markers, and a database CHECK that treats the payload as an exact key allow-list. SK-302
added one optional field to a payload like that with no migration and every booking in
production rolled back. The audio path stays untouched.

Consequences:

- The audio saves whether or not the lyrics save.
- Unchanged text is not sent at all — no pointless stamp bump.
- A lyrics clash during upload does not fail the upload. Toast:
  "Version saved. Lyrics unchanged — <name> edited them while you uploaded."

## UI

### Upload modal

A visible row directly under `Version label`, **outside** the "Stage and notes (optional)"
disclosure. That disclosure already holds a dead field: the "Notes for artist" textarea
writes `track_versions.description`, which no screen renders and which `SongPageVersion`
does not even carry. Grey + collapsed + "optional" is where fields go to die.

The row shows state without opening: badge `24 lines` when written, `optional` when empty.
Tapping expands an inline textarea.

Pre-fill by mode:

| Mode | Behaviour |
| --- | --- |
| `new-song` | empty, editable |
| `new-version` (from the song page) | pre-filled with the song's lyrics, editable |
| `library` (destination picked from a dropdown) | if the chosen song already has lyrics: read-only, "already written — open the song to edit" |

Library mode stays read-only on purpose. Shipping every song's full lyrics into that
dropdown's payload would bloat the page for a rare path. `UploadTrackModalTrack` only
gains a cheap `hasLyrics` / line count.

### Song page

A full-width row under the player, immediately above the existing mobile Notes row, shown
at **every** width. It copies that row's exact shape and classes — label left, badge right,
`min-h-14`, full width — so there is no new visual language and the header action row
(`V2 ▾` / `Upload new Version` / `Mark ready`) does not gain a fourth pill that would wrap
to three lines at 390px.

Guests never see the row.

### Popup

- Always an editable textarea. No read/edit mode toggle to explain.
- `Save lyrics` stays disabled until the text actually differs, so a reader cannot save by accident.
- Closing with unsaved changes shows an inline bar with a `Discard` button — **not** a second
  dialog. Nested dialogs land under the overlay in this codebase (SK-298).
- Footer: `Updated by you · 3 days ago`, or `Not written yet`.
- Character counter appears only near the 8,000 cap.

### Hebrew

`dir="auto"` on the textarea and on the display. Hebrew lyrics flip right-to-left by
themselves inside the English UI. This does not touch the wider Hebrew/RTL work, which is
still unapproved and whose language switcher stays unmounted.

## Files expected to change

- `packages/db/src/schema.ts`, `packages/db/drizzle/0062_song_lyrics.sql`
- `apps/web/src/server/domain/song-management/db.ts` — `setSongLyrics` next to `updateSongMetadata`
- `apps/web/src/server/domain/song-management/service.ts`
- `apps/web/src/server/trpc/routers/project.ts` and `artist.ts` — one procedure each
- `apps/web/src/components/music/song-page.tsx` — wire type, row, dialog state
- `apps/web/src/components/music/lyrics-dialog.tsx` — new
- `apps/web/src/components/dashboard/song/upload-track-modal.tsx` — the field
- route loaders that build `SongPageData` (producer + artist)
- tests alongside each

## Out of scope

- Lyrics history / previous saves.
- Lyrics on public listen links or the portfolio.
- Timed or synced lyrics.
- Surfacing the existing dead `track_versions.description`. It is worth a separate ticket.
