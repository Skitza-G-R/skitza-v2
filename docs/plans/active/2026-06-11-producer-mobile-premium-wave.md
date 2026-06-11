# Producer mobile premium wave — plan

**Date:** 2026-06-11 · **Source:** Gili's phone audit of skitza.app (5 screenshots, 8 issues) · **Goal:** a producer using the app on a phone finds zero UI/UX bugs or glitches. Lead-frontend quality bar.

All work is mobile-scoped (`<lg` — the breakpoint where the bottom tab bar appears). Desktop stays pixel-identical. Each PR follows the SK-47 pattern: desktop markup preserved (wrapped `hidden lg:*` where needed), mobile gets purpose-built compact components.

## The 8 issues → 5 PRs

| Linear | Issues | Scope |
|---|---|---|
| SK-53 | 1 + 3 | Mobile home = activity feed only · remove mobile search bar |
| SK-54 | 2 | Clients & Projects mobile density + alignment |
| SK-55 | 4 + 5 | Music library mobile tighten · mini-player → full-screen player |
| SK-56 | 6 + 7 | Calendar: sessions-first tabs on mobile · availability redesign |
| SK-57 | 8 | Store mobile premium pass (cards, toolbar, new-product wizard) |

## Research findings (applied across PRs)

### Lists & density (HubSpot / Square / Stripe / Material)
- Two-line list rows with avatar: **72px row, 40px avatar, 16px edge padding**; name 15px/600 + one 13px muted line; right side = **one number that matters** (e.g. "₪450 due") + status. Never a 3-column stat block per row.
- Premium apps use edge-to-edge rows with hairline dividers inside one card, not stacked individual cards.
- KPI tiles: max 3–4, one compact strip; never horizontal-scroll data.
- Filter chips: one horizontally scrollable row, **32px chips**, ~4 visible at 390px.
- Touch targets ≥44px.

### Activity feed (Stripe mobile / Linear inbox)
- Action card = 36–40px icon tile + 15px title + one-line context + **single clear CTA**; group under 13px uppercase section headers; tap-to-act.

### Music library + player (Spotify / Samply)
- Library: slim header (title + actions as icons/buttons top-right, search icon-triggered), chip row under header, sort row ("Recents ⇅" left, grid/list toggle right), 72px list rows w/ 64px covers, 2-col grid → ~171px tiles at 390px.
- Samply: render files as songs (artwork/title/version, never filenames); waveform-first now-playing.
- Mini player: 56–64px floating card inset ~8px, docked above tab bar, 40px cover, title + artist 13px, play/pause only, 2px progress line, whole bar tappable.
- Full-screen player: chevron-down (44px) + context label header; artwork ≈ screen width − 32–48px; 22px title + 16px artist; seek bar (4px track); **64px play/pause**, 36px prev/next. Slide-up 300–350ms ease-out, collapse ~250ms, swipe-down dismiss.

### Availability (Calendly / Cal.com)
- Day rows **stack** below sm: header line 44–48px (toggle left, day name 15px/600, right = hours total or "Unavailable"), time ranges stacked beneath, 8px gap.
- Ranges as compact select pairs (90px each) or quiet text rows opening a bottom sheet. "+ Add hours" ghost row; copy-to-days behind an icon → checklist sheet.

## Per-PR approach

### SK-53 — Home + topbar (PR A)
- `app-topbar.tsx` (shared; artist mounts it `hidden lg:block` so `<lg` changes hit producer only): search pill `hidden lg:inline-flex`; breadcrumb/section label becomes visible at all widths (was `hidden md:block`). Mobile chrome = section label + bell.
- `/dashboard` mobile: new `MobileTodayFeed` (`lg:hidden`) replaces banners + OverviewScreen (those get `hidden lg:block`). Feed = compact greeting → "Needs you" action cards (pending approvals, grouped session follow-ups — fixes the duplicate-card bug, payment received w/ dismiss, urgent projects, setup nudge) → Today's session → Recent activity rows. Cut on mobile: public link strip, financial pulse, recent uploads. Payment amount of ₪0 is no longer rendered as "paid ₪0".

### SK-54 — Clients (PR B)
- Client cards → 72px two-line rows in one hairline-divided card; owed amount as the single right-side highlight; LINKED → small status dot/chip.
- KPI tiles → one compact 2-up strip; chips one 32px rhythm; toggle + sort aligned on a single row.

### SK-55 — Music + player (PR C)
- `library-screen.tsx` is shared with artist — every change verified on both roles.
- Producer mobile library: slim header row (title + Upload button), controls collapse into chips + one sort/view row, tight grid (16px gutters/gaps).
- `persistent-player.tsx` MobileDock: add `.expanded` class-toggle full-screen state per research spec (CSS transitions, reduced-motion-safe).

### SK-56 — Calendar (PR D)
- `calendar-tabs.tsx`: Schedule tab hidden `<lg`; mobile default tab = Sessions (server-side default depends on viewport — handle by keeping `?tab=schedule` working but linking mobile users to sessions; pending card moves into sessions panel for mobile rendering).
- `availability-panel.tsx`: mobile day rows per research; desktop unchanged.

### SK-57 — Store (PR E)
- Product cards compact; toolbar one row; wizard sheet: fix text chop, tile sizes, step-bar truncation, sticky footer, internal scroll.

## Verification (every PR)
1. Temp preview route (`app/screenshot-preview/`, never committed) mounting changed components with rich mock data.
2. CDP screenshots at a **true 390px viewport** (headless Chrome clamps windows to ≥500px — use the Emulation.setDeviceMetricsOverride script) + scrollWidth probe = 390 exactly.
3. Desktop spot-check at 1440 (changed pages) — must be pixel-identical.
4. Artist regression for shared files (topbar, library-screen, player).
5. Full gate: `pnpm typecheck && pnpm -F web lint && pnpm test`.

## Out of scope (this wave)
- Desktop redesign of any page (Gili: "ignore desktop atm").
- Real notifications drawer behind the bell (bell stays a dot signal).
- Search palette redesign (mobile entry removed; ⌘K stays on desktop).
