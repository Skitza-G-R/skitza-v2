# Portfolio page redesign, design doc

**Route:** `/dashboard/portfolio` (producer side, desktop only)
**Approved by:** Gili, 2026-05-17
**Brainstorm session:** auto-mode, /impeccable + /high-end-visual-design
**Approach:** B, "Curate" (vertical single-column, up/down arrow reorder, no crop UI)
**Build:** in a separate session, not this one

> Mirror copy. Canonical lives at `docs/plans/active/2026-05-17-portfolio-redesign-design.md` in the Skitza repo. Kept on Desktop so a parallel session's branch flip cannot wipe it.

---

## 0. Build-session decisions — 2026-05-18

This section overrides the relevant subsections below. It captures the layout pivot Gili requested plus the four code-vs-doc reconciliations discovered when reading the v3-clean checkout.

### 0.1 Layout pivot

Hard constraint: **the page must fit on a single screen, no scroll**, at 1440×900 (MacBook Pro 14"). Sanity-check at 1280×720. This overrides the vertical single-column architecture in §3.2 below and adjusts §3.4 / §3.5 / §3.6. Motion choreography, schema (per §0.2), backend (per §0.2), tests, and out-of-scope list stand as written.

### 0.2 Doc-vs-code reconciliations

The build doc was written against an assumed greenfield schema. Reading v3-clean revealed pre-existing structure that already supports most of what the doc asked for. Net result: less migration, less server code, same user experience.

| Doc said | v3-clean reality | Locked decision |
|---|---|---|
| Migration 0018 adds `sort_index` to `portfolio_tracks` and `producer_external_links` | Both tables already have `position integer NOT NULL DEFAULT 0` | **Skip migration 0018.** Use existing `position` column. Saves the broken-drizzle-journal-at-0018 risk noted in user memory. |
| New `portfolio.reorder({id, direction})` and `producerExternalLinks.reorder({id, direction})` mutations | Both routers already export `reorder({ orderedIds: string[] })` with ownership guards (per-row `WHERE producer_id = ctx.producerId`) | **Reuse existing bulk reorder.** UI computes the swapped array client-side (for a 2-row swap this is `[a, b] -> [b, a]`) and calls the existing API. No new server code. |
| `producerExternalLinks.add({ url })` only | Currently `add({ platform, url, title })` | **Real change.** Simplify input to `{ url }`. Detect platform server-side via new `detect-platform.ts`. Title field dropped (it was never rendered on the public page). |
| `producerExternalLinks.list` orders by `sort_index ASC, created_at ASC` tiebreak | Already orders by `asc(position)` | **No change.** Existing order suffices. |
| Remove `isPublicSample` toggle entirely | Real feature, consumed by `public-profile` router + `public-samples-player` on /join | **Q1=B locked.** Drop the toggle UI. Keep the column. New tracks created through portfolio default to `isPublicSample = true` (curation == publication). Existing `false` rows stay `false`. Render a small "Public" mono badge on rows where `isPublicSample = true`. |
| Inline title/artist edit on portfolio rows | Real feature in `actions.ts::updatePortfolioTrack` | **Drop from new UI.** Music library owns those fields. The action stays in case another surface needs it. |
| Portfolio page owns profile-image upload | No image upload exists anywhere in Skitza. Audio uses multipart R2 but there's no image bucket, no presigned-PUT pattern, no Settings upload UI either. The `brand.logoUrl` field is a free-form external URL today. | **Q2=D locked.** Photo section is dropped from this PR. Building the first producer image upload is its own 6-8h task with new R2 config; out of scope. The left column in §0.3 below is just social links (no photo card). A follow-up brief will add the upload later — touching Settings and Portfolio simultaneously. |

### 0.3 New layout (Option 1, two columns — photo block dropped per §0.2 / Q2=D)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  PORTFOLIO  (eyebrow)                              [View public page ↗]  │
│  Portfolio.                                                                │
├────────────────────────┬─────────────────────────────────────────────────┤
│                        │                                                  │
│  Social links          │  Featured tracks       [ Add from library + ]   │
│  PASTE THE URL.        │                                                  │
│  WE FIGURE OUT THE     │  ▲▼ ▶ ▁▂▃▅▇▇▆▄▃▂  Title           [Public]    │
│  PLATFORM.             │           Artist                3:42  ×          │
│                        │  ▲▼ ▶ ▁▂▄▆▇▆▄▂▂▁  Title           [Public]    │
│  [Paste a link…  Add ↗]│           Artist                2:58  ×          │
│                        │  ▲▼ ▶ ▁▂▃▅▇▇▆▄▃▂  Title                       │
│  ▲▼  Spotify           │           Artist                4:12  ×          │
│       open.spotify…  × │  ▲▼ ▶ ▁▂▄▆▇▆▄▂▂▁  Title           [Public]    │
│  ▲▼  YouTube           │           Artist                3:30  ×          │
│       youtube.com/…  × │  ▲▼ ▶ ▁▂▃▅▇▇▆▄▃▂  Title                       │
│  ▲▼  Apple Music       │           Artist                3:55  ×          │
│       music.apple…   × │                                                  │
│  ▲▼  SoundCloud        │  (max 5 rows)                                    │
│       soundcloud.…   × │                                                  │
│  …up to 7 platforms    │                                                  │
└────────────────────────┴─────────────────────────────────────────────────┘
```

**Grid:**
- Left column: roughly 38% width. Social links only (photo section removed per Q2=D).
- Right column: roughly 62% width. Featured tracks. The showcase gets the most space.
- One row of horizontal padding above the columns separates them from the page title.

**Caps to guarantee one screen:**
- Featured tracks: max 5. UI disables the "Add from library" button at the 5-row cap.
- Social links: max 7 (one per supported platform). Schema unique(producer_id, platform) already enforces this — pasting a duplicate platform returns a BAD_REQUEST.

**Section labels:**
- Original brief had ~56px Syne titles. Shrunk to ~24px Syne weight 700 in the new layout. Helper line stays the same mono micro-label.
- Page header "Portfolio." title stays as-is (existing component, do not redesign).

**Motion stays the same** as §3.7 below: 720ms fade-up entry stagger, FLIP row swap on reorder, etc. The entry stagger walks left column first (social links), then right column (track rows in sequence).

### 0.4 Files touched by this PR (locked)

Concrete, after applying §0.2 reconciliations and §0.3 layout:

| Path | Change |
|---|---|
| `apps/web/src/lib/external-links/detect-platform.ts` | **new** |
| `apps/web/src/lib/external-links/__tests__/detect-platform.test.ts` | **new** |
| `apps/web/src/server/trpc/routers/producer-external-links.ts` | simplify `add` to `{ url }`, detect platform server-side |
| `apps/web/src/server/trpc/routers/__tests__/producer-external-links.test.ts` | update tests for new `add` signature |
| `apps/web/src/server/trpc/routers/portfolio.ts` | default `isPublicSample: true` in `create` (per Q1=B) |
| `apps/web/src/server/trpc/routers/__tests__/portfolio.test.ts` | add test for new default |
| `apps/web/src/app/(producer)/dashboard/portfolio/page.tsx` | add "View public page ↗" pill in header; pass new shape to panel |
| `apps/web/src/app/(producer)/dashboard/portfolio/portfolio-panel.tsx` | rebuild as 2-col Option 1 (no photo), smart-paste link input, Public badges, ▲▼ reorder, mini waveform rows, motion, one-screen at 1440×900 |
| `apps/web/src/app/(producer)/dashboard/portfolio/actions.ts` | `addExternalLink` drops `platform` and `title` params; new `reorderPortfolioTracks` and `reorderExternalLinks` wrappers around existing `reorder` mutations |
| `apps/web/src/app/(producer)/dashboard/portfolio/__tests__/page.test.ts` | extend to cover new shell + public-page pill |

Files explicitly **not** touched:
- `packages/db/src/schema.ts` (no schema change)
- `packages/db/drizzle/*` (no migration)
- `apps/web/src/components/dashboard/setup/portfolio-section.tsx` (onboarding still uses it as-is)
- `apps/web/src/app/(onboarding)/onboarding/portfolio/*`
- `apps/web/src/app/(public)/join/[slug]/page.tsx` (public consumer; behavior unchanged)
- `apps/web/src/server/trpc/routers/public-profile.ts` (public consumer; behavior unchanged)
- `apps/web/src/components/join/public-samples-player.tsx`

**New layout (Option 1, two columns):**

```
┌──────────────────────────────────────────────────────────────────────────┐
│  PORTFOLIO  (eyebrow)                              [View public page ↗]  │
│  Portfolio.                                                                │
├────────────────────────┬─────────────────────────────────────────────────┤
│                        │                                                  │
│  Profile image         │  Featured tracks       [ Add from library + ]   │
│  (Syne, ~24px, weight 700) │                                              │
│  SQUARE · JPG/PNG · 5MB│  ▲▼ ▶ ▁▂▃▅▇▇▆▄▃▂  Title                         │
│                        │           Artist                3:42  ×          │
│   ┌──────────────┐     │  ▲▼ ▶ ▁▂▄▆▇▆▄▂▂▁  Title                         │
│   │              │     │           Artist                2:58  ×          │
│   │  [photo]     │     │  …up to 5 rows                                  │
│   │              │     │                                                  │
│   └──────────────┘     │                                                  │
│   [ Change image ↗ ]   │                                                  │
│   Remove               │                                                  │
│                        │                                                  │
│  Social links          │                                                  │
│  PASTE THE URL.        │                                                  │
│  [ Paste a link…  Add ↗]                                                  │
│  ▲▼  Spotify                                                              │
│       open.spotify.com/…                              ×                   │
│  ▲▼  YouTube                                                              │
│       youtube.com/…                                   ×                   │
│  …up to 7 platforms (Spotify, YouTube, Apple Music, SoundCloud,           │
│   Bandcamp, Tidal, Instagram)                                              │
└────────────────────────┴─────────────────────────────────────────────────┘
```

**Grid:**
- Left column: roughly 35% width. Profile image on top, social links below.
- Right column: roughly 65% width. Featured tracks. The showcase gets the most space.

**Caps to guarantee one screen:**
- Featured tracks: max 5. UI disables the "Add from library" button at the 5-row cap.
- Social links: max 7 (one per supported platform). Detector already enforces this — pasting a duplicate platform returns `BAD_REQUEST`.

**Section labels:**
- Original brief had ~56px Syne titles. Shrunk to ~24px Syne weight 700 in the new layout. Helper line stays the same mono micro-label.
- Page header "Portfolio." title stays as-is (existing component, do not redesign).

**Motion stays the same** as §3.7 below: 720ms fade-up entry stagger, FLIP row swap on reorder, etc. The entry stagger still walks top-to-bottom, but per-column (left column rows first, then right column).

---

## 1. Scope

The page becomes the producer's "showcase canvas," the single place to edit the public face shown on `/join/[slug]`.

**Owns:**
- Profile image (`producers.logoUrl`)
- Featured tracks (selected from the music library)
- Social links (Spotify, YouTube, SoundCloud, Apple Music, Bandcamp, Tidal, Instagram)

**Does not own (orphan fields, addressed separately):**
- Bio, genres, released summary, streams summary, response hours.

These render on `/join/[slug]` today via JoinHero and JoinMetaStrip, but have no editor since the Settings redesign (PR #116) dropped them. A follow-up brief will route them either to this page or to a dedicated `/dashboard/public-page` route. Out of scope for this redesign.

## 2. Decisions locked during brainstorm

| Question | Decision |
|---|---|
| Page purpose | Showcase canvas. Producer-facing canvas with bigger visuals. A `View public page` link opens `/join/[slug]` in a new tab for the real thing. Not a live preview. |
| Content scope | PRD-lean. Profile image, featured tracks, social links. Nothing else. |
| Tracks UI | Waveform rows. Mini wavesurfer per row using the `tracks.peaks` JSONB pre-computed by PR #135. |
| Social links UI | Simple rows with smart-paste. One input, paste a URL, server detects the platform. No dropdown. |
| Approach | B, Curate. Up and down arrow reorder buttons on both lists. No crop UI on the image. No drag-and-drop. |
| Page fit (build session) | **Two-column, one-screen at 1440×900.** Tracks right, photo+links left. Caps: 5 tracks, 7 links. |

## 3. UI plan

### 3.1 Vibe and color

- **Vibe Archetype:** Editorial Luxury. Matches Skitza's existing warm cream palette, Syne display font, Outfit body, mono micro-labels, amber-copper accent.
- **Color strategy:** Restrained. Tinted cream neutrals plus `--brand-primary` amber at less than 10% surface coverage. The amber period on the `Portfolio.` title is the only color flourish in the page chrome.
- **Theme:** Light. Scene: a solo music producer in a home studio, mid-afternoon, calmly curating the face they show the world.

### 3.2 Page architecture

**Superseded by §0.** Two-column layout, one screen, no scroll. See §0 diagram.

### 3.3 Page header

- Eyebrow: tiny mono `PORTFOLIO`, tracking 0.18em, muted color.
- Display title: existing `Portfolio.` in Syne, period in `--brand-primary`. Do not redesign.
- Top-right pill, detached from the title line: `View public page ↗`. Pill is `rounded-full`, inner padding `px-5 py-2.5`, the arrow nested in a small circle (button-in-button pattern). Opens `/join/[slug]` in a new tab.
- No second-level nav, no breadcrumbs, no tabs.

### 3.4 Section 1, Profile image (left column, top)

**Label row:**
- Section label `Profile image`, Syne ~24px weight 700.
- One mono helper line: `SQUARE  ·  JPG OR PNG  ·  UP TO 5MB`. Dots, not pipes.

**Card and actions:**
- A **double-bezel** image card. Outer shell `rounded-[2rem] bg-[rgb(var(--bg-overlay))/0.4] p-2 ring-1 ring-[rgb(var(--border-subtle))]`. Inner core `rounded-[calc(2rem-0.5rem)]` with the image, or the amber-copper monogram fallback identical to JoinHero. Producer sees exactly what the public fallback would render.
- Card size scaled down to ~160px so the left column fits photo + links on one screen.
- Primary action below the card: pill `Change image ↗` with button-in-button trailing arrow.
- Tiny secondary `Remove` link under it, low contrast, visible only when an image is set. Click triggers an inline confirm, not a modal.
- Upload pipeline: presigned R2 PUT, save URL to `producers.logoUrl`. CSS `object-fit: cover` does the visual square crop. No crop dialog.

### 3.5 Section 2, Featured tracks (right column, full height)

**Label row:**
- Label `Featured tracks` (Syne ~24px weight 700).
- Mono helper: `PICK YOUR BEST. ARROWS REORDER.`
- Top-right primary action: pill `Add from music library +`. Disabled when 5 tracks already selected, with tooltip-less ghost copy `Limit reached (5)` in mono micro-text below the label.

**Rows:**
- List of waveform rows. Each row is its own mini double-bezel card:
  - Outer shell `rounded-[1.25rem] p-[3px] bg-[rgb(var(--bg-overlay))/0.4]`.
  - Inner core `rounded-[calc(1.25rem-3px)] px-4 py-3 bg-[rgb(var(--bg-base))]`.
  - Row contents, left to right: stacked `▲ ▼` arrow buttons (each 24px, ghost styling, disabled state low contrast on first or last row), circular play / pause button (filled amber on play, ghost on pause), mini waveform 36px tall rendered from `tracks.peaks` (amber for played, muted neutral for unplayed), `Title` body weight 600 with `Artist` 12px muted underneath, duration right-aligned in mono, hover-revealed `×` remove button.
- Empty state: dashed `rounded-[2rem]` outline, ~200px tall, mono micro-text in the center: `NO FEATURED TRACKS YET. ADD ONE FROM YOUR MUSIC LIBRARY.` With a small ghost button `Add from music library +` inside.

### 3.6 Section 3, Social links (left column, bottom)

**Label row:**
- Label `Social links` (Syne ~24px weight 700).
- Mono helper: `PASTE THE URL. WE FIGURE OUT THE PLATFORM.`

**Input + rows:**
- Single smart-paste input below the helper. Pill-shaped, `rounded-full`, `px-5 py-3`. Placeholder: `Paste a Spotify, YouTube, SoundCloud link...`. Inline trailing button-in-button `Add ↗`. Enter or click submits. On unknown URL, a quiet inline message under the input: `We do not recognise that platform yet.` No toast, no modal.
- List of platform rows. Same mini double-bezel card as the tracks rows but slimmer. Row contents: stacked `▲ ▼` arrows, Phosphor Light platform icon (single weight, single color), `Platform name` body weight 600, `truncated.url.here` underneath in mono 11px muted, hover-revealed `×`.
- Empty state: dashed outline card, mono micro-text: `NO LINKS YET. PASTE A SPOTIFY OR YOUTUBE LINK ABOVE TO GET STARTED.`

### 3.7 Motion choreography

- **Page entry:** the section blocks fade up with a slight de-blur over 720ms, staggered 80ms apart, `cubic-bezier(0.32, 0.72, 0, 1)`. `IntersectionObserver` based, no scroll listener. Stagger order: left-column photo, left-column links, right-column tracks header, then track rows in sequence.
- **Buttons:** active state `scale-[0.98]`. Trailing-icon circle inside the button translates diagonally `translate-x-[2px] -translate-y-[1px]` and scales `scale-105` on hover.
- **Reorder:** when ▲ or ▼ is clicked, the two affected rows do a FLIP transition (capture rects, swap, animate `translateY` from old to new position). 240ms, same cubic-bezier. No row flicker. Use React `useLayoutEffect` + ref pattern. No animation library needed.
- **Image upload:** while uploading, the inner core gets a soft amber inner-shadow that breathes (opacity 0.4 to 0.7 to 0.4 over 1400ms, ease-out). On success, a single amber dot pulses in the corner for 600ms then disappears.
- **Input focus:** the smart-paste pill's ring transitions from `--border-subtle` to `rgb(var(--brand-primary)/0.55)` over 200ms. No glow, no halo.

### 3.8 Idiot-proof checklist

- One CTA at a time. Each section has exactly one primary action.
- The helper line under every section label answers "what is this and what do I do here" in seven words or less.
- Destructive actions (`Remove`) are hover-only or styled as secondary text, never adjacent to the primary action.
- Reorder arrows live on the row, not in a hidden menu. Disabled state at the edges (first row top arrow, last row bottom arrow) makes the affordance obvious.
- Empty states tell you exactly the next step, not just "Nothing here."
- The `View public page ↗` link is the single escape hatch to validate what you have done, always visible in the header.

### 3.9 Consciously not doing

- No bento grid. Bento implies parallel concerns, this page is sequential.
- No glassmorphism, no `backdrop-blur` on any card. Reserved for sticky and modal only.
- No gradient text. The amber period on `Portfolio.` is the only color flourish in the page chrome.
- No tabbed interface, no sub-nav, no breadcrumbs.
- No tooltips. Helper text is always visible.
- No new modals beyond the existing library picker. Inline confirms for remove.
- No icons in section labels. Big typography carries the hierarchy.
- No drop shadows on cards. Double-bezel hairline ring plus inset highlight is enough.
- No em dashes in copy. Dot separators or commas instead.

## 4. Schema changes

One migration file: `packages/db/drizzle/0018_portfolio_sort_index.sql`. Migration 0017 is the existing waveform peaks migration, so 0018 is the next free number.

```sql
ALTER TABLE portfolio_tracks
  ADD COLUMN sort_index integer NOT NULL DEFAULT 0;

ALTER TABLE producer_external_links
  ADD COLUMN sort_index integer NOT NULL DEFAULT 0;

-- Backfill existing rows per producer, ordered by created_at ascending.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY producer_id ORDER BY created_at ASC) - 1 AS rn
  FROM portfolio_tracks
)
UPDATE portfolio_tracks p
  SET sort_index = ranked.rn
  FROM ranked
  WHERE p.id = ranked.id;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY producer_id ORDER BY created_at ASC) - 1 AS rn
  FROM producer_external_links
)
UPDATE producer_external_links e
  SET sort_index = ranked.rn
  FROM ranked
  WHERE e.id = ranked.id;

CREATE INDEX IF NOT EXISTS portfolio_tracks_producer_sort_idx
  ON portfolio_tracks (producer_id, sort_index);
CREATE INDEX IF NOT EXISTS producer_external_links_producer_sort_idx
  ON producer_external_links (producer_id, sort_index);
```

Apply via `DATABASE_URL=... node packages/db/apply-migrations.mjs` per the project's standard flow. Vercel deploys do not auto-apply migrations.

## 5. Backend changes

### 5.1 tRPC

- `portfolio.list` returns rows sorted by `sort_index ASC, created_at ASC` as a tiebreaker.
- `producerExternalLinks.list` same ordering.
- New `portfolio.reorder({ id: string, direction: "up" | "down" })` mutation. Server fetches the target row plus the adjacent row (by `sort_index`) in the same producer scope, swaps their `sort_index` values inside a single transaction. Returns the two updated rows.
- New `producerExternalLinks.reorder({ id, direction })`, same shape.
- `producerExternalLinks.add` input changes from `{ platform, url, title }` to `{ url }`. Server runs the platform detector. Title is no longer captured (it was never used in the public render).

### 5.2 Platform detector

New file: `apps/web/src/lib/external-links/detect-platform.ts`.

```ts
const HOST_MAP: Record<string, ExternalPlatformValue> = {
  "spotify.com": "spotify",
  "open.spotify.com": "spotify",
  "music.apple.com": "apple_music",
  "youtube.com": "youtube",
  "www.youtube.com": "youtube",
  "youtu.be": "youtube",
  "soundcloud.com": "soundcloud",
  "bandcamp.com": "bandcamp",
  "tidal.com": "tidal",
  "instagram.com": "instagram_reels",
  "www.instagram.com": "instagram_reels",
};

export function detectPlatform(url: string): ExternalPlatformValue | null {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
  return HOST_MAP[host] ?? null;
}
```

Server-side: detect, if null throw `BAD_REQUEST` with message `"We do not recognise that platform yet."` Otherwise insert with the detected platform.

## 6. Test plan

- `lib/external-links/__tests__/detect-platform.test.ts`: each host maps to the expected platform, unknown hosts return null, malformed URLs return null without throwing.
- `server/trpc/routers/__tests__/portfolio-reorder.test.ts`: swap up, swap down, edge case on first row top arrow (no-op), edge case on last row bottom arrow (no-op), ownership guard (cannot reorder another producer's tracks).
- `server/trpc/routers/__tests__/producer-external-links-reorder.test.ts`: same matrix.
- `server/trpc/routers/__tests__/producer-external-links-add.test.ts`: known hosts insert with correct platform, unknown host returns `BAD_REQUEST`.
- Component test for the new `PortfolioPanel` (if the panel keeps its name): renders rows, click ▲ on row 2 calls the reorder mutation with `direction: "up"`, disabled state on edge arrows.

## 7. Files expected to change

| Path | Change |
|---|---|
| `packages/db/drizzle/0018_portfolio_sort_index.sql` | new |
| `packages/db/src/schema.ts` | add `sortIndex` column on both tables |
| `apps/web/src/lib/external-links/detect-platform.ts` | new |
| `apps/web/src/lib/external-links/__tests__/detect-platform.test.ts` | new |
| `apps/web/src/server/trpc/routers/portfolio.ts` | add `reorder`, change `list` ordering |
| `apps/web/src/server/trpc/routers/producer-external-links.ts` | add `reorder`, simplify `add` input |
| `apps/web/src/app/(producer)/dashboard/portfolio/page.tsx` | replace layout shell, keep server-side fetch pattern |
| `apps/web/src/app/(producer)/dashboard/portfolio/portfolio-panel.tsx` | rebuild as 2-col one-screen Option 1 |
| `apps/web/src/app/(producer)/dashboard/portfolio/actions.ts` | wire reorder mutations, simplify add-link action |
| `apps/web/src/components/dashboard/setup/portfolio-section.tsx` | switch to waveform-row rendering, remove vestigial `isPublicSample` |

Onboarding's `portfolio-step-client.tsx` is intentionally NOT changed here. The onboarding step continues to use the existing simpler list. A follow-up can align it if Gili wants visual parity.

## 8. Out of scope, intentionally

- Bio, genres, released summary, streams summary, response hours editing.
- Image crop dialog. `object-fit: cover` does the visual crop.
- Drag-and-drop reorder. Up and down arrows are the v1 reorder pattern.
- Mobile layout. Producer dashboard is desktop-only per CLAUDE.md.
- Onboarding parity.

## 9. Build expectations for the next session

- Run on a fresh worktree branched off `v3-clean`, named something like `portfolio-redesign`.
- Apply migration 0018 to the local DB before running tests.
- Full gate before pushing: `pnpm typecheck && pnpm -F web lint && pnpm test`, or equivalently `/skitza-verify`.
- Open a PR with base `v3-clean`. After merge, Gili applies migration 0018 to production with the inline DATABASE_URL workflow.
