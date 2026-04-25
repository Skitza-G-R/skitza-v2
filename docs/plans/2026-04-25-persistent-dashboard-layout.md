# Persistent dashboard shell across navigation

**Track:** Standard BMAD · architecture-only · no PRD delta
**Branch:** `fix/persistent-dashboard-shell`
**Date:** 2026-04-25

## Problem

Clicking a sidebar link (Today / Music / Projects / Setup) visibly redraws the entire shell — sidebar, NotificationBell, PersistentPlayer, CoachmarkTour, MobileBottomNav, CommandPaletteTrigger. Navigation IS already client-side at the URL level (Sidebar uses `<Link>`, sidebar.tsx:234), but the shell itself unmounts and remounts because every page renders its own `<AppShell>` wrapper.

Per-page AppShell usages (all 8 pages):

- `(app)/dashboard/page.tsx:108` — `<AppShell active="today">`
- `(app)/dashboard/music/page.tsx:37` — `<AppShell active="music">`
- `(app)/dashboard/projects/page.tsx:66` — `<AppShell active="projects">`
- `(app)/dashboard/projects/[id]/page.tsx:252` — `<AppShell active="projects">`
- `(app)/dashboard/projects/new/page.tsx:28` — `<AppShell active="projects">`
- `(app)/dashboard/booking/page.tsx:93` — `<AppShell active="projects">`
- `(app)/dashboard/settings/page.tsx:95` — `<AppShell active="setup">`
- `(app)/dashboard/onboarding/page.tsx` — same pattern

There is no `(app)/dashboard/layout.tsx`. The route group's only layout `(app)/layout.tsx` does the auth gate + i18n provider but doesn't include the shell.

## Fix

1. **New file: `(app)/dashboard/layout.tsx`** — server component, renders `<AppShell>{children}</AppShell>` once. Everything below `/dashboard/*` shares it. Next.js App Router preserves layout instances across sibling-route navigation, so Sidebar / PersistentPlayer / NotificationBell etc. become true persistent UI.

2. **Move active-key derivation into Sidebar.** Sidebar is already `"use client"`, so it can call `usePathname()` and compute the active key locally. The `active` prop on `<Sidebar>` and `<AppShell>` is removed entirely — fewer props, fewer places to forget to update.

3. **Extract `getActiveKey(pathname): ActiveKey` into a plain TS module** at `apps/web/src/lib/dashboard/active-key.ts`. Plain `.ts`, no `"use client"`, no React imports — so both the client Sidebar and unit tests can consume it. (This pattern matches the lesson logged in CLAUDE.md from audit Task 18: pure predicates belong in plain modules.)

4. **Strip `<AppShell active="X">` from all 8 pages.** Each page returns its own content (the markup that was previously inside `<AppShell>...</AppShell>`).

## Active-key URL mapping

```ts
/dashboard                  → "today"
/dashboard/music…           → "music"
/dashboard/projects…        → "projects"
/dashboard/projects/new     → "projects"
/dashboard/projects/<id>    → "projects"
/dashboard/booking…         → "projects"   (booking rolls up under Projects)
/dashboard/settings…        → "setup"
/dashboard/onboarding       → "setup"      (currently no active prop on this page; default-safe)
fallback                    → "today"
```

Booking-as-projects matches the existing hard-coded `active="projects"` on `booking/page.tsx`. PRD §4 confirms booking is reached via the Projects flow, not as its own top-level nav.

## Tests (TDD discipline)

### RED — failing tests written first, in this order

1. **Architectural invariant** — `apps/web/src/app/(app)/dashboard/__tests__/layout-architecture.test.ts`:
   - Asserts `dashboard/layout.tsx` exists.
   - Reads each `dashboard/**/page.tsx` source and asserts none of them import `AppShell`. Currently 8 do, so it fails 8x.
   - Pattern matches the "first non-empty line isn't `use client`" pin from audit Task 18 (CLAUDE.md mistake log) — file-source assertions for architectural rules are the canonical Skitza pattern.

2. **Active-key derivation unit** — `apps/web/src/lib/dashboard/__tests__/active-key.test.ts`:
   - Table-driven test of `getActiveKey()` covering all 8 path patterns + fallback.
   - Currently the file doesn't exist, so it fails on import.

### GREEN — implementation

In order:
1. Create `lib/dashboard/active-key.ts` with `getActiveKey(pathname): ActiveKey`.
2. Create `(app)/dashboard/layout.tsx` rendering `<AppShell>{children}</AppShell>`.
3. Refactor `Sidebar` — drop the `active` prop, call `usePathname()` + `getActiveKey()` internally.
4. Refactor `AppShell` — drop the `active` prop from the signature; stop passing it to `<Sidebar>`.
5. Strip `<AppShell active="…">…</AppShell>` from each of the 8 pages, leaving only the page-content markup.

## Things that change for free (bonuses)

- `PersistentPlayer` keeps playing audio across navigation — it stops being remounted.
- `getShellState()` (DB call for slug + unread count) goes from per-navigation to per-layout-mount. One fewer round-trip per click. Already wrapped in `React.cache()` (per app-shell.tsx:21–24) but moving up the tree means the cache hits matter less — the call simply doesn't happen.
- `CommandPalette` + `CoachmarkTour` stop re-initialising on every nav.

## Trade-offs / things to watch

- **NotificationBell stale unread counts.** `unreadCount` flowing in via the layout means it's frozen at layout-mount time. If the bell relies on a fresh server count per-page, navigation no longer refreshes it. The bell already has its own client-side mechanism (notification-bell.tsx) — verifying it polls or invalidates via tRPC mutation will be part of QA.
- **Coverage gap.** Existing `sidebar.test.tsx` only tests static `NAV_ITEMS` data — it doesn't render the component or pass `active`, so removing the prop won't break anything. No existing page-level rendering tests assert on AppShell, so the wrapper-strip is also safe.
- **Artist app.** `(artist)/` very likely has the same bug. Out of scope here — separate PR for review hygiene.

## Out of scope

- Artist app shell (`(artist)/`) — same fix, separate PR.
- NotificationBell auto-refresh — only if QA finds it broken.
- Migrating to Next.js parallel routes / intercepting routes (overkill for this).

## Verification

`pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test` (i.e. `/skitza-verify`).

Manual smoke test post-deploy: open dashboard preview URL, click between Today / Music / Projects / Setup, watch the sidebar — it should hold still. Bonus check: start audio in the PersistentPlayer, then navigate, audio should keep playing.

## Commits

One feature commit (the architecture change) is fine; the diff stays under ~150 lines and is logically one move:

```
fix(dashboard): persistent shell across sidebar navigation

Move <AppShell> from per-page wrappers into a shared
(app)/dashboard/layout.tsx so the sidebar, persistent audio player,
notification bell, and coachmark tour stop unmounting on every
navigation. Active nav key is now derived from usePathname() inside
Sidebar via a pure helper at lib/dashboard/active-key.ts.
```
