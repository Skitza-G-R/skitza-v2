# Session Recap — Live Handoff State

> **READ THIS FIRST at the start of every session.** This file is a rolling snapshot of the current project state. It's overwritten at every checkpoint so it always reflects "right now." If you need history, `git log` this file.

---

## 🕐 Last checkpoint

**2026-04-25 — Producer onboarding wizard rebuild: BMAD PM + Architect + SM phases complete on `feat/onboarding-rebuild`. About to dispatch fresh `skitza-tdd-implementer` for Story 01 (pure helpers, TDD-first). 9 stories queued behind it.**

---

## ✅ What this session shipped (so far — all on `feat/onboarding-rebuild`)

| Commit | Phase | Content |
|---|---|---|
| `889b6a7` (rebased) | **PM** | `docs(prd): §4.5 onboarding wizard rebuild — 4-step stepper` — replaces prior 5-step wizard with 4-step full-screen stepper that reuses NewPackageForm + AvailabilitySection + AudioUploader |
| `eaf7238` (rebased) | **Architect + SM** | `docs(onboarding): architecture + 10 self-contained story files` — full technical plan + 10 dispatchable stories |

Branch is rebased on top of latest origin/main (`e2e5efd feat(setup): flatten tabs (#45)`).

---

## 📍 Current state

| Thing | State |
|---|---|
| **Active branch** | `feat/onboarding-rebuild` (2 commits ahead of main, rebased clean) |
| **Working tree** | clean |
| **PR opened?** | not yet — will open after Story 10 (QA polish) per the architecture plan |
| **Tests** | unchanged baseline — docs-only commits this session |
| **Pre-existing WIP** | stashed: `WIP setup-flatten-tabs polish + 2026-04-25 audit docs (pre-onboarding-rebuild)` — recover with `git stash pop` after this branch ships |

---

## 🎯 What's next (in BMAD order)

1. **Dispatch Story 01** (skitza-tdd-implementer) — pure helpers `slugFromDisplayName` + `currencyFromCountry` in `apps/web/src/lib/onboarding/derive.ts`. ~30 min, no UI.
2. **Story 02** — shell + progress bar + action bar primitives. ~1h.
3. **Story 03** — Step 1 page + `completeStudio` server action with slug-retry + invisible currency from `x-vercel-ip-country`. ~1.5h.
4. **Stories 04-08** — service / availability / portfolio steps, mostly reuse existing components.
5. **Story 09** — step-aware decide-redirect + drop-off matrix tests.
6. **Story 10** — `skitza-ux-critic` + mobile 360px audit + smoke + open PR.

Total estimate: ~10h dev + 1h QA polish over 3-5 calendar days at solo-founder cadence.

---

## 🗂 Where everything lives for this rebuild

- **PRD §4.5** (canonical product spec): [`docs/product/PRD.md`](product/PRD.md) — committed as `docs(prd):` BEFORE any code per BMAD discipline.
- **Architecture doc**: [`docs/plans/active/2026-04-25-onboarding-rebuild-architecture.md`](plans/active/2026-04-25-onboarding-rebuild-architecture.md) — schema impact (none), server contracts, component tree, motion specs, test strategy, edge cases.
- **Story files**: [`docs/plans/stories/onboarding-rebuild-NN-*.md`](plans/stories/) — 10 self-contained subagent dispatches.
- **Existing components reused (no edits)**: `package-form.tsx`, `availability-section.tsx` (+ 5 children), `audio-uploader.tsx`, `gcal-sync-badge.tsx`.
- **New code lives at**: `apps/web/src/app/(onboarding)/onboarding/{studio,service,availability,portfolio}/`, `apps/web/src/components/onboarding/`, `apps/web/src/lib/onboarding/`.

---

## 🔑 How to resume from cold

1. Read this file.
2. Read [CLAUDE.md](../CLAUDE.md) — auto-loaded.
3. `git checkout feat/onboarding-rebuild` (if not there).
4. Open the architecture doc + Story 01.
5. Dispatch a fresh `skitza-tdd-implementer` for the next un-shipped story (CLAUDE.md anti-pattern: one agent doing all stories → context rot).
6. After each story: `/skitza-verify` → next story.

---

## 🟠 Known bugs still on main (quarantine list — unchanged from previous session)

Diagnosable now with Sentry + PostHog live. No touching these files until ~1 week of real-user data:

1. `/sign-in` line 8: `forceRedirectUrl="/dashboard"` — ignores `redirect_url` query param
2. `/artist-welcome` (no slug): no role guard for authed users with real studios
3. Webhook race on `/artist-welcome/<slug>` — fast-clickers land on `/artist` before `client_contacts` row exists

---

## 🧹 Update discipline

**This file is overwritten, never appended.** Update at every natural checkpoint per `CLAUDE.md` § Session handoff protocol.
