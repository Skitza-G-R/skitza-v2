# Session Recap — Live Handoff State

> **READ THIS FIRST at the start of every session.** This file is a rolling snapshot of the current project state. It's overwritten at every checkpoint so it always reflects "right now." If you need history, `git log` this file.
>
> **For Claude**: you are required to update this file at natural checkpoints (see `CLAUDE.md` § Session handoff protocol). For the user: this is the answer to "where did we stop?"

---

## 🕐 Last checkpoint

**2026-04-22 — Critical /join sign-up routing bug fixed (audit Task 15). Strict TDD. Awaiting Gili's manual verification of the full /join → /sign-up/join/<slug> → /artist-welcome/<slug> → /artist flow.**

---

## ✅ What we just finished

- **Audit Tasks 1 + 2** fixed earlier in the session (migration 0031 applied; `publicProfile.forJoin` wrapped in try/catch; post-hoc TDD with RED-verified test).
- **Audit Task 15** (newly discovered during manual QA): **`/join/<slug>` sign-up was registering visitors as Producers** and funneling them into producer onboarding. Three compounding bugs:
  1. Default `/sign-up` page had `forceRedirectUrl` hardcoded — overrode query-param redirects.
  2. Clerk webhook unconditionally created a producer row for every new user — no role concept.
  3. `(app)/layout.tsx` saw the fresh producer row and sent users to `/onboarding`.
- **Fix (3 layers + 1 splash), strict TDD:**
  - **New route:** `/sign-up/join/[slug]/page.tsx` renders Clerk's `<SignUp>` with `unsafeMetadata={signupOrigin:"join", producerSlug:slug}`.
  - **Webhook** (`api/webhooks/clerk/route.ts`): reads `unsafe_metadata`, resolves slug against DB, branches. JOIN → insert `client_contacts`; DEFAULT → existing producer-insert (unchanged). Malformed slug → safe fallback to default.
  - **Layout decision:** extracted `decideAppLayoutRedirect` as pure function (testable without Clerk + DB mocks). Layout now routes artists-with-client_contacts to `/artist`, not `/onboarding`.
  - **Artist-welcome splash:** new `/artist-welcome/[slug]/page.tsx` greets just-joined artists with producer name + CTA to `/artist`.
  - **Default `/sign-up`:** `forceRedirectUrl` → `fallbackRedirectUrl` (defense-in-depth).
- **TDD rigor**: 4 new webhook tests (A/B/C/D) + 7 decide-redirect tests. TDD-A, TDD-C, and all 7 decide-redirect tests were RED first (verified). All 11 GREEN after the fix. **595 passed / 4 skipped / 0 failed** (up from 584).
- **Paper trail updated**: `docs/audit-report.md` Task 15 added with full fix log + architectural notes.

---

## 📍 Current state

| Thing | State |
|---|---|
| **Active branch** | `main` — working tree DIRTY with Task 15 fix unstaged |
| **Unstaged changes** | 10 files (4 new, 6 modified) |
| **Production DB** | ✅ Migrated through 0031 |
| **Typecheck** | ✅ Passes |
| **Lint** | ✅ Passes |
| **Tests** | ✅ 595 passed / 4 skipped / 0 failed |
| **Open PRs** | None — awaiting Gili's manual verification before opening one for Tasks 1+2+15 combined |
| **Launch clock** | Day 2 of 12-week post-launch roadmap; target revenue July 10, 2026 |

### Files touched this session (cumulative: Tasks 1 + 2 + 15)

**New files:**
- `apps/web/src/app/(auth)/sign-up/join/[slug]/page.tsx` — dedicated join-origin sign-up route
- `apps/web/src/app/(artist-welcome)/artist-welcome/[slug]/page.tsx` — joined-artist splash
- `apps/web/src/app/(app)/decide-redirect.ts` — pure routing-decision function
- `apps/web/src/app/(app)/__tests__/decide-redirect.test.ts` — 7 TDD tests
- `docs/audit-report.md` — the paper trail

**Modified files:**
- `apps/web/src/app/api/webhooks/clerk/route.ts` — metadata branching
- `apps/web/src/app/api/webhooks/clerk/route.test.ts` — 4 new TDD tests + upgraded mocks
- `apps/web/src/app/(app)/layout.tsx` — wired to decide-redirect + client_contacts lookup
- `apps/web/src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` — dropped `forceRedirectUrl`
- `apps/web/src/components/join/signup-cta.tsx` — point at new join route
- `apps/web/src/server/trpc/routers/public-profile.ts` — Task 2 try/catch (from earlier)
- `apps/web/src/server/trpc/routers/__tests__/public-profile-for-join.test.ts` — Task 2 resilience test
- `docs/INDEX.md` — audit-report link
- `CLAUDE.md` — mistake log entry for the Task 2 TDD miss

---

## 🎯 What's next (in order)

1. **👤 Gili manually verifies the /join → /sign-up/join/<slug> → /artist-welcome/<slug> → /artist flow** in production (or preview).
   - Expected: signup succeeds, no producer row created for the artist, Welcome splash shows producer's name, "Open my artist workspace" lands on `/artist`, manual visit to `/dashboard` redirects to `/artist` (not `/onboarding`).
2. **Claude commits everything** (Tasks 1 + 2 + 15) in logical chunks once Gili confirms. Likely 2-3 commits:
   - `fix(public-profile)`: Task 2 try/catch + resilience test
   - `fix(clerk-webhook,auth,app-layout)`: Task 15 full 3-layer fix
   - `docs(audit)`: paper-trail updates
3. **Remaining audit items**: 12 tasks still ⏳ Pending. Next-highest impact per earlier ordering:
   - Task 10 (landing placeholder content — credibility win, ~30 min)
   - Task 4 (onboarding 4 vs 5 steps — real spec drift, ~1-2h)
   - Task 7 (Privacy + Terms counsel-reviewed — pre-launch legal)

Full list: `docs/audit-report.md`.

---

## 🧠 Context that matters right now

- **🔴 Runway: ~3 months.** Revenue by July 2026 is non-negotiable.
- **Paper-trail discipline**: every audit fix updates `docs/audit-report.md` in the same commit as the code. Never let the tracker drift from reality.
- **Migration journal still broken**: continue using `node packages/db/apply-migrations.mjs` until someone repairs `_journal.json`.
- **TDD rule reinforced** (CLAUDE.md mistake log, 2026-04-22): any defensive wrapper / error-handler / new code branch gets a failing test first. Migrations + infra work correctly skip TDD.
- **Auto mode is on**: continuous execution with manual verification checkpoints.
- **BMAD enforcement** active on `main` (hook + skill + hard-gate). Task 15 correctly invoked BMAD Standard track.

---

## 🔑 How to resume from cold

1. Read this file (you're here).
2. Read [CLAUDE.md](../CLAUDE.md) — auto-loaded.
3. Read [docs/audit-report.md](audit-report.md) — for the 15-task paper trail + status.
4. Read [docs/INDEX.md](INDEX.md) for the master map.
5. Run `git status && git diff --stat && gh pr list --state open`.
6. Default next action: if Tasks 1 + 2 + 15 are ✅ Fixed and working tree is dirty, wait for Gili to verify the /join signup flow, then commit. If committed, pick the next-highest-impact audit task.

---

## 📋 Files to glance at if diving back in

- [docs/audit-report.md](audit-report.md) — **the paper trail** (15 tasks, status, fix logs)
- [apps/web/src/app/api/webhooks/clerk/route.ts](../apps/web/src/app/api/webhooks/clerk/route.ts) — Task 15 webhook branching
- [apps/web/src/app/(app)/decide-redirect.ts](../apps/web/src/app/(app)/decide-redirect.ts) — Task 15 pure routing function
- [apps/web/src/app/(auth)/sign-up/join/[slug]/page.tsx](../apps/web/src/app/(auth)/sign-up/join/[slug]/page.tsx) — Task 15 dedicated join sign-up
- [docs/plans/active/2026-04-21-post-launch-roadmap.md](plans/active/2026-04-21-post-launch-roadmap.md) — the 12-week plan
- [docs/product/PRD.md](product/PRD.md) — normative spec
- [docs/INDEX.md](INDEX.md) — master map

---

## 🧹 Update discipline

**This file is overwritten, never appended.** Update at every natural checkpoint per `CLAUDE.md` § Session handoff protocol.
