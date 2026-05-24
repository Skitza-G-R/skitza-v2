# Artist home — high-fidelity redesign (handoff package)

**Linear:** [SK-33](https://linear.app/raz-stamper/issue/SK-33/artist-home-high-fidelity-redesign-handoff-package)
**Branch:** `giasraf/sk-33-artist-home-high-fidelity-redesign-handoff-package` (off `v3-clean`)
**Status:** Design approved 2026-05-24. Awaiting implementation plan via `superpowers:writing-plans`.

## What we're building

The `/artist` landing page, redesigned to a single-screen, hierarchy-first dashboard. The handoff package lives at:

- `/Volumes/KINGSTON/Downloads/design_handoff_artist_home/` — README + reference JSX/CSS
- `/Volumes/KINGSTON/Downloads/Artist Home - Skitza.html` — bundled artboard

Top to bottom, one column:

1. **Greeting strip** — date eyebrow + `Good afternoon, {firstName}.`
2. **Last upload** (primary) — full-width hero with album art, big Play FAB, track title, two buttons
3. **Next session** (secondary) — compact one-row strip with avatar, title, time, TODAY badge, single `Open calendar →` CTA
4. **Payment requests** (tertiary) — thin list, copper amounts, dark Pay buttons
5. **Book a session** (quaternary) — quiet producer tiles

The existing `PersistentPlayer` keeps doing the "floating player" job — no change there.

## Decisions baked into the design (do not re-litigate)

1. **Replace SK-26 entirely.** PR #151's inbox model (focal card + also-waiting list) is gone. We delete those components on this branch.
2. **Keep the existing `AppTopBar`.** Do not hide it on `/artist`. The handoff's "Region 1 — Header" becomes a small in-page greeting strip; we drop the search input and `+ New project` CTA (artists don't create projects in Skitza; search isn't built).
3. **Approach A — no schema changes.** Drop fields we don't have: producer city, session kind tag, studio subtitle, in-person flag. Light backend additions only (`unread`, `plan`).
4. **Responsive mobile in the same PR.** Same component tree, breakpoints adapt: hero stacks, producer tiles wrap. No separate mobile route.
5. **Hierarchy by size.** Title sizes ladder `26 → 16 → 14 → 12.5`. The amber Play FAB is the single brightest, biggest target on the page — a brand-new artist should tap it first 95% of the time.

## Hierarchy ladder (the numbers)

| Slot | Element | Value | Notes |
|---|---|---|---|
| **Primary — Last upload** | Card width | 100% | Full content width |
| | Album art | 170×170 | bigger than handoff's 128 |
| | Play FAB | 52px | inside the art, bottom-right |
| | Track title | Syne 800, 26px, -0.03em tracking | headline |
| | Card height | ~190px | tallest block on the page |
| **Secondary — Next session** | Layout | One-row strip | ~72px tall |
| | Title | Syne 700, 16px | |
| | CTA | Outline pill `Open calendar →` | single CTA, no Join |
| **Tertiary — Payments** | Section title | Syne 700, 14px | |
| | Row height | ~52px | unchanged from handoff |
| | Amount | Syne 800, 14.5px, **`--copper`** | only place copper appears |
| **Quaternary — Book tiles** | Tile name | Outfit 600, 12.5px | |
| | Tile height | ~56px | unchanged from handoff |

## Layout sketch

```
┌───────────────────────────────────────────────────────────────┐
│ TUE · MAY 24                                                  │
│ Good afternoon, Yael.                                         │
│                                                               │
│ ┌──────────────────────────────────────────────────────────┐  │
│ │  ┌─────────┐                                             │  │
│ │  │         │  LAST UPLOAD · NEW                          │  │
│ │  │  [art]  │                                             │  │
│ │  │   ▶     │  Drift v3                                   │  │
│ │  │         │  Gili Studio · 12 min ago                   │  │
│ │  │  170px  │                                             │  │
│ │  └─────────┘  [ ▶ Play track ]  [ Open library → ]       │  │
│ └──────────────────────────────────────────────────────────┘  │
│                                                               │
│ ┌──────────────────────────────────────────────────────────┐  │
│ │ [GS]  Vocal tracking · Take 4   TODAY  [Open calendar →] │  │
│ │       Tue 16:00–18:00 · 120m                             │  │
│ └──────────────────────────────────────────────────────────┘  │
│                                                               │
│ Payment requests  2 OPEN · $1,700              Pay all →     │
│ ─────────────────────────────────────────────────────────    │
│ [GS] Drift EP    Gili · 50-50         $1,400      [Pay]      │
│ [RM] Honey       Ravid · 50-50         €300       [Pay]      │
│                                                               │
│ Book a session   3 IN ROSTER               Browse all →      │
│ ─────────────────────────────────────────────────────────    │
│ [tile]  [tile]  [tile]                                       │
└───────────────────────────────────────────────────────────────┘
```

## Data — what we already have

Source: `apps/web/src/server/trpc/routers/artist.ts`.

| UI slot | tRPC source | Available fields |
|---|---|---|
| Last upload | `artist.home().latestMix` | `id`, `trackTitle`, `label`, `producerName`, `producerSlug`, `projectId`, `uploadedAt`, `audioUrl`, `durationMs` |
| Next session | `artist.home().nextSession` | `id`, `startsAt`, `durationMin`, `producerName`, `producerSlug`, `productName` |
| Payment requests | `artist.book.myPendingPayments().bookings[]` | `id`, `startsAt`, `producerName`, `packageName`, `amountCents`, `currency` |
| Book tiles | `artist.studios().studios[]` | `producerId`, `producerName`, `producerSlug`, `producerLogoUrl`, `lastSeenAt` |

## Backend tweaks (small, no schema)

1. **`artist.home().latestMix`** — add `unread: boolean`.
   - True when the artist's `clientContacts.lastSeenAt` for that producer is null or earlier than `track.uploadedAt`.
   - Drives the `NEW` badge on the primary card.
2. **`artist.book.myPendingPayments().bookings[]`** — add `plan: '50-50' | 'upfront' | 'monthly'`.
   - Already computed inline (the `firstPlan.kind` switch that drives `amountCents`). Just surface it.
   - Drives the `Gili · 50-50` meta line on each payment row.

No schema migrations.

## Fields we drop (do not invent UI for these)

| Handoff field | Why we drop |
|---|---|
| Producer city (`Tel Aviv`) | Not in `producers` schema |
| `in-person` session tag | Not in `bookings` schema; v1 has no remote sessions anyway |
| Session kind (`tracking` / `review` / etc.) | Not in `bookings` schema; brittle to infer from package name |
| Studio subtitle (`Indie · vocal-led`) | Not in `producers` schema |
| Per-track `Take 4` version label | We have `latestMix.label` (e.g. `v3`, `demo`) — use that instead |
| Header search input | Artists have no global search yet |
| `+ New project` header CTA | Artists don't create projects in Skitza |

If any of these matter later, they belong to a follow-up Linear issue with the schema work.

## Tokens & fonts

- Add to `apps/web/src/app/globals.css`:
  ```css
  --copper: #B06830;  /* payment amounts only */
  ```
- Add **JetBrains Mono** to the Google Fonts `<link>` (we already load Syne + Outfit via PR #138).
- All other tokens (`--brand-primary`, `--bg-background`, `--bg-elevated`, `--bg-sidebar`, `--fg-default`, `--fg-muted`, `--border-subtle`) already exist and match the handoff exactly.
- Producer gradient: reuse the existing `deriveGradient` helper (already used on the producer side; derives hue from id).

## Mobile

Same component tree. Breakpoints:

- `lg:` (≥1024px): layout as sketched above.
- `<lg`: hero card stacks (art on top, content below), next-session strip wraps the CTA to the second line, producer tiles wrap to 2 columns.
- Payments list and section headers are already responsive — no change.

## CTAs and where they navigate

| CTA | Destination | Notes |
|---|---|---|
| Big Play FAB inside the art | (no nav) | calls `playerPlay({ versionId, audioUrl })` — plays in `PersistentPlayer` |
| `Play track` pill | (no nav) | same as the FAB |
| `Open library →` pill | `/artist/music/{projectId}` | drops the artist on the project's song list |
| `Open calendar →` next-session CTA | `/artist/book` | opens the booking/sessions page |
| Per-row `Pay` button | (modal or `/artist/payment/{bookingId}`) | reuses the existing artist payment flow |
| `Pay all →` section action | `/artist/book` (sessions view filtered to pending payments) | uses the existing route |
| `Browse all →` book section action | `/artist/book` | full browse view |
| Producer tile | `/artist/book?producerId={id}` | producer-specific booking |

## Files

### New (built on this branch)

```
apps/web/src/components/artist/home/
  greeting-strip.tsx
  last-upload-card.tsx
  next-session-card.tsx
  payment-requests-section.tsx
  book-session-tiles.tsx
  producer-art.tsx                 # shared gradient + sheen + initials block
  __tests__/last-upload-card.test.ts
  __tests__/next-session-card.test.ts
  __tests__/payment-requests-section.test.ts
  __tests__/book-session-tiles.test.ts
```

### Modified

```
apps/web/src/app/(artist)/artist/page.tsx              # rewrite — fetch, compose
apps/web/src/server/trpc/routers/artist.ts             # add unread + plan fields
apps/web/src/app/globals.css                           # --copper, JetBrains Mono link
apps/web/src/app/layout.tsx (or font loader)           # JetBrains Mono import
apps/web/src/server/trpc/routers/__tests__/artist-home.test.ts  # update for unread field
```

### Deleted (existing v3-clean artist home)

The SK-26 inbox components (`focal-card.tsx`, `inbox-hero.tsx`, `also-waiting-list.tsx`, `this-week-strip.tsx`, `activity-tail.tsx`, `book-with-studios.tsx`, `balance-snapshot.tsx`, `build-subline.ts`) were never merged — they only exist on the SK-26 branch and are not on `v3-clean`. We don't touch them.

What we DO delete on this branch are the **current v3-clean** artist home components:

```
apps/web/src/components/artist/home/home-hero.tsx
apps/web/src/components/artist/home/latest-mix-card.tsx
apps/web/src/components/artist/home/next-session-card.tsx           # name reused for new strip
apps/web/src/components/artist/home/upcoming-sessions-card.tsx
apps/web/src/components/artist/home/balance-card.tsx
apps/web/src/components/artist/home/activity-feed.tsx
```

Plus any `__tests__/*.test.ts` files matched to those components.

**Naming collision:** the new `next-session-card.tsx` reuses the filename of the deleted one. Delete first, then create. Treat it as a rewrite.

## Empty states

| Slot | Condition | Render |
|---|---|---|
| Last upload | `latestMix === null` | Same card chrome and size; copy: `Nothing new from your studios yet.` + outline button `Open library →` |
| Next session | `nextSession === null` | Same strip; copy: `No session booked.` + filled amber CTA `Book a session →` (points to `/artist/book`) |
| Payments | `myPendingPayments.bookings.length === 0` | Section hides entirely |
| Book tiles | `studios.studios.length === 0` | Section shows a single placeholder tile with copy `Find a studio` linking to `/artist/book` |

## Acceptance criteria (for the manual QA pass before merge)

- [ ] `/artist` renders the new layout with no console errors
- [ ] Greeting eyebrow uses Mono 10.5px / .12em, greeting is Syne 22px 800
- [ ] Last upload card: art is 170×170, Play FAB is 52px amber, title is Syne 26px
- [ ] `NEW` badge appears when `unread === true` and hides otherwise
- [ ] Clicking the FAB or "Play track" begins playback in `PersistentPlayer`
- [ ] Next session strip: TODAY badge appears only when `startsAt` is today, `Open calendar →` navigates to `/artist/book`
- [ ] Payment row amount is `--copper` (`#B06830`); Pay button is dark/amber-text pill
- [ ] `--copper` is defined in `globals.css` and used ONLY on payment amounts
- [ ] Producer tile grid renders one tile per studio; each tile links to `/artist/book?producerId={id}`
- [ ] All four empty states render their fallback copy + CTA
- [ ] Mobile (`<lg`): hero stacks, tiles wrap to 2 cols, no horizontal scroll
- [ ] JetBrains Mono is loaded and visible on eyebrows and amounts
- [ ] `pnpm typecheck && pnpm -F web lint && pnpm test` all pass

## What's NOT in this PR (follow-ups)

- Adding `producers.city`, `producers.subtitle`, `bookings.kind`, `bookings.location` columns
- Real video-call wiring behind a Join button on the next-session strip
- Global search in the topbar
- An artist-side "+ New project" surface (none planned — projects come from bookings)

## How the next session resumes this

1. Read this design doc.
2. Confirm branch is `giasraf/sk-33-artist-home-high-fidelity-redesign-handoff-package`.
3. Invoke `superpowers:writing-plans` against this design doc to produce the step-by-step implementation plan.
4. Build, verify (`pnpm typecheck && pnpm -F web lint && pnpm test`), push, open PR with title `SK-33: artist home — high-fidelity redesign`.
