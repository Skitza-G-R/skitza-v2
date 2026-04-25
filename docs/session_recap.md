# Session Recap — Live Handoff State

> **READ THIS FIRST at the start of every session.** This file is a rolling snapshot of the current project state. Overwritten at every checkpoint; for history `git log` this file.

---

## 🕐 Last checkpoint

**2026-04-25 mid-afternoon — persistent dashboard shell shipped (PR #43). The producer dashboard sidebar, PersistentPlayer, NotificationBell, CoachmarkTour, MobileBottomNav, and command palette no longer remount on sibling-route navigation. Verified live on prod by Gili. Audio survives navigation; sidebar holds still.**

---

## ✅ What shipped today (PR #43)

- **Moved `<AppShell>` into a shared `(app)/dashboard/layout.tsx`** so the shell instance survives sibling-route navigation. Previously every page rendered its own copy → shell remounted on every click.
- **Pure `getActiveKey(pathname)` helper** at `apps/web/src/lib/dashboard/active-key.ts` — plain TS module, server-safe, single source of truth for URL → ActiveKey mapping. Sidebar derives active state via `usePathname()` instead of a per-page prop.
- **Bonus fix**: `mobile-bottom-nav.tsx` had its own private `getActiveKey` that returned null for `/dashboard/booking` — meaning the mobile bottom nav showed no active tab on booking routes while desktop highlighted Projects. Unified onto the shared helper.
- **2 new test files (26 tests)** pin the architectural invariant via file-source reads (matches the `"use client"` invariant style from PR #39 audit Task 18). Future contributor cannot accidentally re-wrap a page in `<AppShell>` without RED-test failure.

### Other PRs that landed since 2026-04-23 recap

| PR | Title |
|---|---|
| #38 | Post-merge ops followup — observability verification + playbooks |
| #39 | Project page RSC boundary crash (audit Task 18) |
| #40 | R2 bucket CORS policy for browser uploads (audit Task 19) |
| #41 | Contributor onboarding guide |
| #42 | Branded PDF generator for the onboarding guide |
| #43 | Persistent dashboard shell (this checkpoint) |

---

## 📍 Current state

| Thing | State |
|---|---|
| **Active branch** | `main` (in sync with origin) |
| **HEAD** | `0cc5b4e` (PR #43) |
| **Tests** | 676 pass / 4 skipped / 0 fail (+38 since 2026-04-23) |
| **Typecheck / Lint / Build** | ✅ all clean |
| **Prod schema** | up to migration 0033 (no schema change in #43) |
| **Sentry / PostHog** | ✅ live |
| **Autopilot cron** | deployed, **not scheduled** (Hobby tier) |
| **Launch clock** | Day 5 of 12-week post-launch roadmap |

---

## 🟠 Known bugs still on main (quarantine list — diagnosable with Sentry/PostHog)

1. `/sign-in` — `forceRedirectUrl="/dashboard"` ignores `redirect_url` query param
2. `/artist-welcome` (no slug) — no role guard for authed users with real studios
3. Webhook race on `/artist-welcome/<slug>` — fast-clickers land on `/artist` before `client_contacts` row exists

**Files NOT to touch:** `(auth)/sign-in/*`, `(auth)/sign-up/*`, `(artist)/artist/layout.tsx`, `(artist-welcome)/**/*`, `api/webhooks/clerk/**/*`.

---

## 🎯 What's next (priority order)

### Direct follow-ups from PR #43

1. **Same fix on artist app** — `(artist)/` very likely has the per-page shell pattern. Mirror PR #43 in a separate small PR.
2. **NotificationBell unread-count refresh** — count is now fetched once per layout-mount instead of per-navigation. If staling shows up in PostHog session replays, the bell needs its own client-side poll.

### Pre-existing roadmap

3. Watch PostHog Activity + Sentry Issues daily — 5 min each morning
4. **Task 4** — onboarding 4 → 5 steps (PRD §4.5 — missing Portfolio + Stripe)
5. **Task 9** — kill `/dashboard/booking` (duplicates Setup, confusing UX)
6. **Task 10** — landing page TODO placeholders
7. **Task 3** — S04 UI (embed parsers + `/join` Section B)
8. **Task 17 Phases 2+3** — artist desktop sidebar salvage

### Parked (need Gili's input)

- **Task 5** — refund policy content
- **Task 6** — cookie banner (EU compliance)
- **Task 7** — Privacy + Terms (counsel review required)

---

## 🔧 Ops playbooks (carry-over)

### Apply migrations to prod

```bash
set -a && . apps/web/.env.local && set +a
node packages/db/apply-migrations.mjs
```

### Verify PostHog proxy is live without leaking a key

```bash
curl -s "https://skitza.app/ingest/decide?v=3" -H "Content-Type: application/json" -d '{"token":"dummy"}'
```

Expect: `The provided API key is invalid or has expired.` — proves proxy + upstream both work.

### Smoke-test autopilot cron on prod

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://skitza.app/api/cron/autopilot
```

### Merge a PR with `audit-report.md` conflict

Cascade is expected on every PR after the first that touches it. Resolution: rebase, **keep both halves** of the status table, re-run gates, force-push-with-lease, squash-merge.

---

## 📋 Files to glance at if diving back in

- [`docs/plans/2026-04-25-persistent-dashboard-layout.md`](plans/2026-04-25-persistent-dashboard-layout.md) — plan for PR #43
- [`docs/qa/2026-04-23-observability-verification.md`](qa/2026-04-23-observability-verification.md) — Sentry + PostHog live verification
- [`docs/audit-report.md`](audit-report.md) — 17-task tracker
- [`docs/plans/active/2026-04-21-post-launch-roadmap.md`](plans/active/2026-04-21-post-launch-roadmap.md) — 12-week plan
- [`docs/product/PRD.md`](product/PRD.md) — normative spec
- [`docs/INDEX.md`](INDEX.md) — master map

---

## 🔑 How to resume from cold

1. Read this file.
2. Read [CLAUDE.md](../CLAUDE.md) — auto-loaded.
3. `gh pr list --state open` — should show only #1, #16, #28, #29 (all pre-existing).
4. Open PostHog Activity + Sentry Issues tabs — review the last 24h.
5. Pick from "What's next" — likely the artist-app mirror of PR #43.

---

## 🧹 Update discipline

**This file is overwritten, never appended.** Update at every natural checkpoint per `CLAUDE.md` § Session handoff protocol.
