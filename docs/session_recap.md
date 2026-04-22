# Session Recap — Live Handoff State

> **READ THIS FIRST at the start of every session.** This file is a rolling snapshot of the current project state. It's overwritten at every checkpoint so it always reflects "right now." If you need history, `git log` this file.
>
> **For Claude**: you are required to update this file at natural checkpoints (see `CLAUDE.md` § Session handoff protocol). For the user: this is the answer to "where did we stop?"

---

## 🕐 Last checkpoint

**2026-04-22 — Audit Tasks 1, 2, 15, 16 all ✅ Fixed + committed on PR #30. Task 17 design brief published, awaiting Gili's approval before implementation.**

---

## ✅ What we just finished

**Task 16 — Strict role isolation (🔴 critical, done today):**
- **`resolveUserRole` helper** (`apps/web/src/server/auth/role.ts`) — pure function classifying every authed user as `unauthenticated` / `artist` / `producer-incomplete` / `producer-complete` / `orphan`. 8 unit tests, RED-verified first.
- **`/onboarding` layout gate** — new `decide-redirect.ts` policy (5 tests) wired into the layout. Artists typing `/onboarding` now redirect to `/artist`; fully-onboarded producers redirect to `/dashboard`.
- **`completeOnboarding` action hardening** — server-side role check rejects artists even if they craft a raw POST (closes the Q2 hole Gili asked me to close). 3 new tests.
- **16 new tests total, strict TDD everywhere.** Full suite: **611 passed / 4 skipped / 0 failed** (up from 595).

**Task 17 — Design brief published, not built yet:**
- Scope confirmed with Gili: Option C (full rebuild) but **artist-only feature set**. Desktop sidebar chrome matching producer side, mobile stays PWA-style bottom nav.
- Design brief at [`docs/plans/active/2026-04-22-artist-ui-rebuild-design.md`](plans/active/2026-04-22-artist-ui-rebuild-design.md).
- 3-phase implementation plan (UserButton unblock → desktop sidebar → settings page).
- **3 open questions for Gili in §7 of the brief.**

---

## 📍 Current state

| Thing | State |
|---|---|
| **Active branch** | `fix/audit-tasks-2-15-artist-signup` — contains Tasks 1 + 2 + 15 + 16 |
| **Open PR** | [#30](https://github.com/giasraf/skitza-v2/pull/30) — preview URL auto-updates per push |
| **Production DB** | ✅ Migrated through 0031 |
| **Typecheck** | ✅ Passes |
| **Lint** | ✅ Passes |
| **Tests** | ✅ 611 passed / 4 skipped / 0 failed |
| **Launch clock** | Day 2 of 12-week post-launch roadmap; target revenue July 10, 2026 |

---

## 🎯 What's next (in order)

1. **👤 Gili re-tests the full /join signup flow on the preview URL** — Tasks 15 v2 + 16 both live in the branch. Expected:
   - Signup via `/join/<slug>` completes (email verification works, no white page).
   - New artist lands on `/artist-welcome/<slug>` → `/artist` (artist home renders).
   - Typing `/dashboard` redirects to `/artist` ✓
   - **NEW:** typing `/onboarding` ALSO redirects to `/artist` (Task 16's main win) ✓
2. **👤 Gili reviews Task 17 design brief + answers 3 open questions** in §7 of the brief (collapsible sidebar, notifications, settings-tab-on-mobile).
3. **🤖 Claude implements Task 17 in 3 phases**, per the brief. Each phase is a separate commit on the same PR branch.
4. **👤 Gili merges PR #30** once Task 17 lands. Closes audit Tasks 1 + 2 + 15 + 16 + 17 in one PR.
5. **Remaining audit items**: 10 tasks still ⏳ Pending. Next-highest impact:
   - Task 10 (landing placeholder content — credibility win, ~30 min)
   - Task 4 (onboarding 4 vs 5 steps — spec drift, ~1-2h)
   - Task 7 (Privacy + Terms counsel-reviewed — pre-launch legal)

Full list: [`docs/audit-report.md`](audit-report.md).

---

## 🧠 Context that matters right now

- **🔴 Runway: ~3 months.** Revenue by July 2026 is non-negotiable.
- **Paper-trail discipline (proven today):** every audit fix updates `docs/audit-report.md` in the same commit. Tasks 16 Fix Log + Task 17 design brief captured alongside the code.
- **TDD rule reinforced**: Task 16 went RED-first for every new behavior (3 separate RED verifications: resolveUserRole, decide-redirect, action hardening). No vacuous tests.
- **Migration journal still broken**: continue using `node packages/db/apply-migrations.mjs` until someone repairs `_journal.json`.
- **Auto mode is on**: continuous execution with manual verification checkpoints.
- **BMAD enforcement** active on `main`. Task 17 correctly went through the full BMAD flow (Analyst → PM → Architect → *waiting on user* → Dev).

---

## 🔑 How to resume from cold

1. Read this file (you're here).
2. Read [CLAUDE.md](../CLAUDE.md) — auto-loaded.
3. Read [docs/audit-report.md](audit-report.md) — 17-task paper trail + per-task fix logs.
4. Read [docs/INDEX.md](INDEX.md) for the master map.
5. Read [docs/plans/active/](plans/active/) — Task 17 design brief lives here.
6. Run `git status && git log --oneline -10 && gh pr list --state open`.
7. Default next action: check if Gili has answered Task 17's §7 questions. If yes, start Phase 1 implementation. If no, wait.

---

## 📋 Files to glance at if diving back in

- [docs/audit-report.md](audit-report.md) — **the paper trail** (17 tasks, status, fix logs)
- [docs/plans/active/2026-04-22-artist-ui-rebuild-design.md](plans/active/2026-04-22-artist-ui-rebuild-design.md) — Task 17 design brief (pending Gili)
- [apps/web/src/server/auth/role.ts](../apps/web/src/server/auth/role.ts) — Task 16 shared role resolver
- [apps/web/src/app/(onboarding)/onboarding/decide-redirect.ts](../apps/web/src/app/(onboarding)/onboarding/decide-redirect.ts) — Task 16 routing policy
- [apps/web/src/app/(onboarding)/onboarding/actions.ts](../apps/web/src/app/(onboarding)/onboarding/actions.ts) — Task 16 action hardening
- [docs/plans/active/2026-04-21-post-launch-roadmap.md](plans/active/2026-04-21-post-launch-roadmap.md) — the 12-week plan
- [docs/product/PRD.md](product/PRD.md) — normative spec

---

## 🧹 Update discipline

**This file is overwritten, never appended.** Update at every natural checkpoint per `CLAUDE.md` § Session handoff protocol.
