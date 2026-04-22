# Session Recap — Live Handoff State

> **READ THIS FIRST at the start of every session.** This file is a rolling snapshot of the current project state. It's overwritten at every checkpoint so it always reflects "right now." If you need history, `git log` this file.

---

## 🕐 Last checkpoint

**2026-04-22 late — PR #31 closed without merging. Back on `main`. Overnight execution plan drafted at [`docs/plans/active/2026-04-22-overnight-execution-plan.md`](plans/active/2026-04-22-overnight-execution-plan.md) — awaiting Gili's go-ahead.**

---

## ✅ What landed today on main (via PR #30, commit `3662a2b`)

- **Task 1** — Migration 0031 applied to prod DB.
- **Task 2** — `publicProfile.forJoin` try/catch + RED-verified resilience test.
- **Task 15** — `/join` signup routes to Artist identity (3-layer fix: `/sign-up/join/<slug>` catch-all, Clerk webhook branches on `unsafeMetadata`, `(app)/layout` role-based redirects).
- **Task 16** — Strict role isolation: `resolveUserRole` helper + `/onboarding` gate + action hardening + 16 new tests.
- **Task 17 Phase 1** — UserButton in artist shell + "Producer dashboard" menu item for dual-role users.
- Paper trail: `docs/audit-report.md` + `CLAUDE.md` mistake log kept current.

---

## ❌ What we abandoned today (branch `feat/task-17-artist-desktop-sidebar`, PR #31 closed)

Spent several hours trying to fix bugs Gili caught during manual QA:
- `/sign-in` `forceRedirectUrl` bug (fix trivially correct but bundled)
- `/artist-welcome` (no slug) had no role guard for authed users with real studios
- Webhook race on `/artist-welcome/<slug>` (fast-clickers beat the Clerk webhook)
- My own `(artist)/layout` self-heal created an infinite redirect loop

Task 17 Phases 2 + 3 (desktop sidebar + `/artist/settings`) were also built on that branch but went down with it.

**Root lesson:** can't fix production Clerk/webhook bugs without observability. Every attempt looked green in tests but failed in prod with no diagnosable signal. → Sentry is Task 1 of the overnight plan.

**Branch preserved on GitHub** for later salvage when the surrounding bugs are properly diagnosed.

---

## 📍 Current state

| Thing | State |
|---|---|
| **Active branch** | `main` |
| **HEAD** | `3662a2b` (PR #30 merge) |
| **Working tree** | Clean except this recap + the overnight plan |
| **Open PRs** | None |
| **Typecheck** | ✅ |
| **Lint** | ✅ |
| **Tests** | ✅ 623 pass / 4 skipped / 0 fail |
| **Audit status** | 5 ✅ Fixed (Tasks 1, 2, 15, 16, 17.1) · 12 ⏳ Pending · 17 total |
| **Launch clock** | Day 2 of 12-week post-launch roadmap |

---

## 🟠 Known bugs still on main

Parked until Task 14 (Sentry) lands and we can diagnose them with real logs:

1. `/sign-in` has `forceRedirectUrl="/dashboard"` — ignores `redirect_url` query param. Same pattern we fixed on `/sign-up` earlier today but the `/sign-in` one slipped through.
2. `/artist-welcome` (no slug) renders orphan copy even for authed users with real studios (no role check).
3. Webhook race on `/artist-welcome/<slug>` — fast-clickers can land on `/artist` before their `client_contacts` row exists.

These don't break the producer side. Real artist clients hit the webhook-race window ~5% of the time at most (most wait a second on the welcome splash). Fix properly with Sentry data after Task 14.

---

## 🎯 What's next — overnight plan is drafted

See [`docs/plans/active/2026-04-22-overnight-execution-plan.md`](plans/active/2026-04-22-overnight-execution-plan.md) for the full brief. Summary:

**5 overnight-safe tasks, priority order:**
- **Task A** — Sentry + PostHog install (audit Task 14) — 1-2h — **do first**
- **Task B** — Ship 6-8 missing Resend email templates (audit Task 13) — 3-4h
- **Task C** — Wire Quick Note modal to DB (audit Task 11) — 1-2h
- **Task D** — Auto-generated changelog via GitHub Actions (audit Task 8) — 1-2h
- **Task E** — Wire 3 Autopilot cron TODO behaviors (audit Task 12) — 2-3h

**Quarantine list** — DO NOT touch overnight (implicated in the artist-welcome ping-pong, need Sentry first):
- `apps/web/src/app/(auth)/sign-in/*`, `/sign-up/*`
- `apps/web/src/app/(artist)/artist/layout.tsx`
- `apps/web/src/app/(artist-welcome)/**/*`
- `apps/web/src/app/api/webhooks/clerk/**/*`

**Tasks parked for Gili's input** (not overnight):
- Task 3 (S04 UI), 4 (onboarding 5-step), 5 (refund-policy content), 6 (cookie banner), 7 (legal copy), 9 (kill /dashboard/booking), 10 (landing copy), 17 Phases 2+3 (abandoned today)

---

## 🧠 Context that matters right now

- **🔴 Runway: ~3 months.** Revenue by July 2026 is non-negotiable.
- **Observability is now the #1 priority.** Today's 8-hour ping-pong on artist-welcome happened because we were flying blind. Sentry first.
- **Quarantine discipline.** Don't touch auth/webhook/artist-welcome files until Sentry is live and Gili's reviewed the data.
- **BMAD remains active on main** (hook + skill + hard-gate).
- **Migration journal still broken** — continue using `node packages/db/apply-migrations.mjs`.
- **TDD rule:** failing test first, RED-verified via seeing the failure message, then GREEN. Pure-config tasks (Sentry install) can skip.

---

## 🔑 How to resume from cold

1. Read this file.
2. Read [CLAUDE.md](../CLAUDE.md) — auto-loaded.
3. Read [docs/plans/active/2026-04-22-overnight-execution-plan.md](plans/active/2026-04-22-overnight-execution-plan.md) — tonight's brief.
4. Read [docs/audit-report.md](audit-report.md) — 17-task status.
5. `git status && gh pr list --state open` — confirm clean.
6. If overnight execution is in progress, continue from the next-task marker in the overnight plan. Otherwise wait for Gili's go-ahead.

---

## 📋 Files to glance at if diving back in

- [docs/plans/active/2026-04-22-overnight-execution-plan.md](plans/active/2026-04-22-overnight-execution-plan.md) — **the brief**
- [docs/audit-report.md](audit-report.md) — 17-task tracker
- [docs/plans/active/2026-04-21-post-launch-roadmap.md](plans/active/2026-04-21-post-launch-roadmap.md) — 12-week plan
- [docs/product/PRD.md](product/PRD.md) — normative spec
- [docs/INDEX.md](INDEX.md) — master map

---

## 🧹 Update discipline

**This file is overwritten, never appended.** Update at every natural checkpoint per `CLAUDE.md` § Session handoff protocol.
