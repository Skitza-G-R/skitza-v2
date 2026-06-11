# Clients & Projects — mobile premium wave (2026-06-11)

> **Gili's goal:** every producer mobile flow in the Clients tab is production-ready —
> super fast, 0 bugs, beautiful mobile app design, brilliant UX. Spotify-level.
>
> **In plain English:** the list screens were fixed earlier today (SK-54/SK-58).
> Everything *deeper* — the client page, the album page, the song page, and the
> popups — is still a shrunken desktop page on a phone, and parts of it are
> properly broken. This wave redesigns those screens for the phone.
> Desktop stays pixel-identical.

Scope decision (Gili, 2026-06-11): full section · real mobile-app redesign ·
self-audited · build immediately after this doc lands.

---

## 1. Audit findings (true 390px viewport, CDP probe, head `99fa00d`)

Numbered; each wave below references these. Screenshots: `/tmp/cpmobile/*.png`.

### Broken (bugs)

- **A1 — Album page pans sideways (521px on a 390px screen).** Root cause:
  `TrackRow` uses one desktop grid for all widths
  (`22px 30px 38px minmax(0,1fr) 130px 180px 22px`, track-row.tsx:104). Fixed
  columns sum past the viewport, so the page scrolls sideways **and** the
  `minmax(0,1fr)` title column collapses to 0px — **song titles are invisible**.
- **A2 — Tab rails overflow.** `AlbumTabs` pill rail is 392px wide (358px
  available) → every album tab pans 408px; "Studio Log" pill wraps into a
  2-line blob. `SongTabs` rail is 444px → song-single page pans 461px.
- **A3 — Hero titles crushed to 2 letters.** "Debut Album" renders as "De…",
  "Noa Kirel" as "No…" — the hero flex row (112px avatar + truncating title +
  inline CTAs) leaves the title no room at 390px. Affects `AlbumHero`,
  `SongSpaceHero` (title fully invisible there), `ClientSpaceHero`.
- **A4 — VersionRow title crush.** Grid `36px minmax(0,1fr) 48px 48px 56px 32px`
  leaves ~100px for the song name → renders "G b…".
- **A5 — ClientSpaceHero email overflows** to the screen edge; meta rows cramp;
  the avatar/text/CTA stack order reads wrong on a phone.

### Rough (works, but not a mobile app)

- **A6 — KPI tiles are desktop chrome.** ClientSpace 4-tile band + AlbumStatStrip
  2×2 white cards eat ~2 screens of scroll before content starts.
- **A7 — Payments tab:** milestone labels truncate ("Mid-project pay…"); action
  buttons are desktop pills; amounts don't use tabular/mono figures consistently.
- **A8 — Studio Log / Sessions rows:** layout holds but spacing is desktop-dense;
  session cards have stray gaps.
- **A9 — Modals are shrunken desktop dialogs.** All 7 (new client, new project,
  edit client, invite, remove, add song, upload version) are centered Radix
  dialogs; New project is a long dense form in a floating box.
- **A10 — Loading skeletons** (loading.tsx files) mirror desktop layouts, not the
  new mobile ones.

### Not bugs (verified, don't chase)

- The giant "dead space" under every page in tall screenshots is a capture
  artifact (1600px-tall virtual viewport). At 844px (real phone) it disappears.
- List page (both tabs), client-space project rows, workflow stepper, activity
  feed: already fine.
- Table mode is unreachable on phones (toggle hidden `<md` since SK-58) — no
  mobile table work needed.

## 2. Research (fetched sources; full cites in the session transcript)

| Pattern | Consensus | Sources |
|---|---|---|
| Detail hero | Short. One identity block, ONE visible action + kebab; avatar 72–80px; title 22–24px wrapping max 2 lines; stats = plain number-over-label, not tiles; total hero ≤ ~220px | Spotify artist/album, Airbnb, Linear mobile changelog, IG profile |
| In-page tabs | Horizontally scrollable rail, 44–48px tall, never wraps; edge fade for overflow | Material tabs spec, YouTube chips, IG |
| Money rows | Two-line 64–72px; amount right-aligned `tabular-nums`; status = small chip; tap row → detail/sheet; no swipe-only actions | Monzo teardown, fintech typography guides, Stripe app |
| Track/file rows | 56–72px; 40–48px artwork; 15–16px title + 13px muted secondary; one trailing 44px control; full-row press state | Spotify rows, Material list spec, Samply, Dropbox |
| Forms | Multi-field form → full-screen-style sheet; short task → bottom sheet; never stack sheets | Apple HIG sheets, NN/g bottom sheets |
| Destructive confirm | Bottom action sheet; red destructive on top, Cancel separate | Apple HIG action sheets |
| Numbers cheat-sheet | 44px touch floor; 64px default row unit; 13px caption / 15px body / 22–24px hero title; `env(safe-area-inset-bottom)` on sticky chrome; row-shaped shimmer skeletons | HIG, M3, NN/g |

## 3. Design decisions (mobile `<md` only; md+ byte-identical)

**D1 — One shared mobile hero pattern** for AlbumHero, SongSpaceHero,
ClientSpaceHero. Stacked layout below `md`:
eyebrow (12px caps) → avatar 72px square beside a full-width title that **wraps
up to 2 lines, never truncates to nothing** (Syne is wide — CDP-measure before
fixing sizes; SK-54 measured 28px Syne = 372px) → one 13px meta line →
**inline stat row** (plain number-over-label, 3–4 stats, replaces tiles `<md`)
→ action row: one primary pill (Play latest / + New project) + secondary as
icon/kebab. Desktop keeps the exact current DOM via per-element display
branching (`hidden md:flex` vs `md:hidden` — never flip one element's display
class, stylesheet-order roulette, SK-53 trap).

**D2 — Tab rails become scrollable pill rails** `<md`: one row, no wrap,
`overflow-x-auto` + `scrollbar-none`, full-bleed (`-mx-4 px-4`), 44px tall
pills, edge fade. Both AlbumTabs and SongTabs. Not sticky in this wave
(flagged as a possible follow-up — z-index vs topbar/player dock needs its own
verification).

**D3 — Spotify-style rows** `<md`:
- TrackRow: 64px, two-line — artwork 44px (keep gradient sleeve), title 15px
  truncate-1, secondary 13px muted "Stage · v4 · 3:21 · 2 notes", thin progress
  underline (2px) instead of the 130px bar column, trailing chevron with 44px
  target. Desktop grid untouched at md+.
- VersionRow: 64px — leading version chip (v2), title/date secondary, trailing
  note count + 44px play.
- Payments milestones: 64px — label + date left, amount right in `font-amount`
  tabular figures, status chip; action buttons become full-width 48px stacked.
- Studio Log / Sessions: align to the same row unit; no layout surgery beyond
  spacing + type scale.

**D4 — Modals become sheets on phones** via one shared opt-in CSS class
(`.sk-sheet-mobile` in globals.css): below `md` the Radix Content pins to the
bottom, full-width, rounded-top-[20px], slide-up 340ms (the SK-55 Apple-sheet
curve), `max-h-[92dvh]` inner scroll, sticky footer CTA padded with
`env(safe-area-inset-bottom)`; inputs ≥48px tall. Desktop dialog styling
untouched (class is media-scoped). Applied to all 7 modals. Remove-client
additionally restyles `<md` as an action sheet (red full-width destructive on
top, plain Cancel below — HIG).

**D5 — Stat tiles compact** `<md`: ClientSpace KPI band + AlbumStatStrip render
as one hairline card with a 2×2 quiet grid (13px labels, 17px values,
`font-amount` for money) — mirroring the SK-54 clients-list KPI treatment.

**D6 — Skeletons follow.** Each touched page's loading.tsx gets a `<md` variant
mirroring the new hero + row shapes (row-shaped shimmer, NN/g).

Hard constraints: canonical tokens only (`rgb(var(--token))` — bare var() is
invisible); `rounded-[var(--radius-lg)]` for text rectangles (buttons.md);
m:ss time format; 44px touch floor; no schema, no routes, no new deps.

## 4. Build waves (one Linear issue + PR each, off `origin/v3-clean`)

| Wave | Scope | Fixes |
|---|---|---|
| **W1 — Rows & rails** | TrackRow, VersionRow mobile rows; AlbumTabs + SongTabs scrollable rails | A1 A2 A4 (all sideways panning dies; titles visible) |
| **W2 — Heroes & stats** | Shared mobile hero on Album/Song/ClientSpace + compact stat strips, email/meta fixes | A3 A5 A6 |
| **W3 — Sheets** | `.sk-sheet-mobile` + all 7 modals, action-sheet remove, New-project full-height treatment | A9 |
| **W4 — Money & polish sweep** | Payments rows + buttons, Studio Log spacing, skeletons, full 390/360 re-probe of every screen + modal, fix stragglers | A7 A8 A10 |

Each PR: mobile-only diff, desktop verified byte-identical (1440px before/after
screenshot or DOM-equality where possible), full gate
(`pnpm typecheck && pnpm -F web lint && pnpm test`), 390px capture evidence.

## 5. Verification recipe (carry-forward)

Temp harness `apps/web/src/app/screenshot-preview/page.tsx` (NEVER commit)
mounts WorkspaceListView / ClientSpace / AlbumSpace / SongSpace with mock data;
`?s=` picks the screen. Capture via CDP script (`/tmp/sk53/capture.mjs`-style):
true 390px metrics + scrollWidth probe + `text=` click chains for tabs/modals.
Headless Chrome CLI clamps windows ≥500px — never trust `--window-size=390`.
Use 844px-tall viewports when judging vertical rhythm (taller virtual viewports
fake dead space). First capture after dev-server restart may show stale CSS —
recapture.
