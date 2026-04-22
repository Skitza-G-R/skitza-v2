# Session Recap — Live Handoff State

> **READ THIS FIRST at the start of every session.** This file is a rolling snapshot of the current project state. It's overwritten at every checkpoint so it always reflects "right now." If you need history, `git log` this file.
>
> **For Claude**: you are required to update this file at natural checkpoints (see `CLAUDE.md` § Session handoff protocol). For the user: this is the answer to "where did we stop?"

---

## 🕐 Last checkpoint

**2026-04-22, start of day.** Gili is handing off to a fresh session. Previous session shipped 4 PRs in an AFK sprint (2026-04-21) — all awaiting Gili's review + merge. Main has NOT advanced overnight.

---

## 👋 To the fresh Claude reading this

Welcome back. Here's what matters:

1. **Don't re-execute any of the work below.** PRs #19–#24 all contain work that's already done, committed, pushed. Re-doing any of it is wasted.
2. **Start by running** `git fetch && gh pr list --state open` and `git log --oneline origin/main -10` to confirm the state described here still matches reality. If Gili merged something overnight, the state shifted — trust git over this file.
3. **BMAD is active on main** (merged via PR #17 on 2026-04-21). On any NEW product-change request this session, the hook + CLAUDE.md hard-gate will fire the Analyst phase automatically. Don't skip it.
4. **User is non-dev** — plain English, no jargon. Scale my responses with patience.
5. **Runway is tight** — 3 months to revenue. Default to shipping, not planning.

---

## ✅ What previous session accomplished (2026-04-21)

Long session. Notable milestones:

- **Documentation architecture restructure** shipped via PR #18 (merged): docs/INDEX.md, archive/active plan folders, decisions/ folder, trimmed CLAUDE.md, new `/docs-audit` + `/checkpoint` slash commands, session handoff protocol.
- **BMAD enforcement** shipped via PR #17 (merged): skill + hook + hard-gate active on main.
- **Round 2 BMAD** produced a 45-question Analyst pass → 12-week post-launch roadmap (`docs/plans/active/2026-04-21-post-launch-roadmap.md`). 6 phases. Revenue target Jul 10.
- **4 code PRs shipped in the AFK sprint** (Phase 1 + start of Phase 2 of the roadmap).

---

## 📍 Open PRs awaiting Gili

**ALL of these are Gili-action, not Claude-action.** Do not re-do the work.

| # | Title | Base | Tests | Notes |
|---|---|---|---|---|
| **#19** | docs(bmad): Round 2 decisions + 12-week roadmap | main | — | Merge this FIRST so main has the plan context |
| **#20** | docs(prd): §4.5 Producer first-run onboarding wizard | main | — | Small PRD addition |
| **#21** | feat(join): Wave 1 — /join/\<slug\> teaser + is_public_sample + kill /p | main | 560 passing | 4 commits after rebase |
| **#22** | feat(autopilot): gate 3 stub toggles behind 'Coming soon' (S2.6) | main | +6 TDD | Phase 2 start |
| **#23** | feat(join): Wave 2 S04 — external links backend (migration 0031 + tRPC + forJoin) | **feat/join-flow** | +17 TDD | Retarget to main AFTER #21 merges |
| **#24** | docs(recap): AFK-sprint checkpoint | main | — | This file's previous update |

### Recommended merge order
1. #19 (plan/decisions context for everything downstream)
2. #20 (PRD polish)
3. #21 (Wave 1)
4. **Retarget #23 to main** via GitHub UI (base was feat/join-flow)
5. #22 #23 #24 (any order)

After all merged: run **`/skitza-migrate`** to apply migration 0031 to prod.

---

## 📍 Current state

| Thing | State |
|---|---|
| **Branch** | `docs/recap-after-afk-sprint` (local; PR #24 is this) |
| **Working tree** | clean (before this checkpoint commit) |
| **Main head** | `ab6725a feat(skill): BMAD workflow — Skitza-tailored (#17)` — has not advanced since 2026-04-21 |
| **Stash** | empty |
| **Open PRs** | 6 I opened during the AFK sprint + #16 (unrelated db fix) + #1 (stale Node bump) |
| **Test baseline** | 577 passing on the feat/join-wave-2-external-links tip (PR #23) |
| **Launch clock** | Day 2 of the 12-week roadmap (target July 10 for breakeven) |

---

## 🎯 What's next

**Blocking on Gili (nothing I can do until):**
1. Review + merge PRs #19 → #20 → #21 → #23 → #22 → #24 (approx that order)
2. Run `/skitza-migrate` after #23 merges
3. Provide env vars when needed (RESEND_API_KEY, NEXT_PUBLIC_POSTHOG_KEY, SENTRY_DSN)
4. Block on עוסק פטור registration for real Stripe Connect (Phase 5 critical path)
5. Upload 3-5 real tracks + polish logo + landing copy (Phase 3)
6. Share the 5 beta producer names + DMs (Phase 4)

**Ready for Claude when merges land (pick one on resume):**
- **S04 Part 2**: Setup UI external-links picker + 7 embed components + /join page Section B render (biggest next slice of Wave 2)
- **S2.2 Resend wiring**: 10 email triggers from PRD §14 — needs `RESEND_API_KEY` env var
- **S2.3 Sentry + PostHog install** — needs env vars
- **S2.5 Legal pages drafts** — I draft ToS/Privacy via Termly template, Gili reviews
- **S05 Welcome splash + auto-attach** (Wave 2 continuation)

---

## 🧠 Context that matters (stable, load-bearing facts)

- **Runway: 3 months.** Revenue by July 2026. Breakeven = 100 paying producers (~$2,900 MRR).
- **Gili is non-dev founder** — plain English, explain tech in analogies.
- **BMAD mandatory** via hook + CLAUDE.md — every product-change goes through Analyst first.
- **Gili's pattern**: simpler/cheaper/tighter when options are close.
- **עוסק פטור registration** = single biggest timeline risk.
- **Pricing**: Free + Pro $29/mo (5% platform fee). Beta cohort gets "pay what you want" + 6-month grandfather.
- **Autopilot launch scope**: 2 toggles active (welcomeEmail, commentNotify), 3 "Coming soon" stubs hidden (PR #22).
- **Global English from Day 1** — no Hebrew UI at launch.
- **PRD**: canonical spec at `docs/product/PRD.md` (now includes §4.5 wizard, §7.1 beta pricing, §15.1-2 Autopilot gating, §22.2b p0-only paging, §28 GTM playbook).
- **Reasoning trace** for every PRD decision: `docs/decisions/360-prd-answers.md` (Round 1 + Round 2, 115+ locked answers).

---

## 🔑 How to resume from cold

1. Read this file (you're here).
2. Read [CLAUDE.md](../CLAUDE.md) — auto-loaded. Note § HARD GATE and § Session handoff protocol.
3. Read [docs/INDEX.md](INDEX.md) — master map.
4. Run:
   ```bash
   git fetch && gh pr list --state open
   git log --oneline origin/main -10
   ```
   Confirm this file's "Current state" table matches. If any PR above has merged, the state shifted — re-read this section.
5. **Do not re-execute PRs #19–#24.** They're shipped (pushed, tested, awaiting Gili's review).
6. If Gili says "continue" or "what's next," recommend: either wait for merges OR pick a Phase 2/3 story that doesn't conflict with the open PRs (e.g., Resend wiring, Sentry install).
7. On any new product-change request, let BMAD fire (hook will inject reminder). Ask Analyst questions first.

---

## 📋 Files to glance at if diving back in

- **PR #23** (most recent work): https://github.com/giasraf/skitza-v2/pull/23
- [docs/plans/active/2026-04-21-post-launch-roadmap.md](plans/active/2026-04-21-post-launch-roadmap.md) — **THE 12-week plan** (6 phases, ~28 stories, named ownership)
- [docs/decisions/360-prd-answers.md](decisions/360-prd-answers.md) — 115+ locked product decisions + reasoning
- [docs/product/PRD.md](product/PRD.md) — normative spec
- [docs/INDEX.md](INDEX.md) — master map

---

## 🧹 Update discipline (for next me)

Overwrite, never append. Update at every natural checkpoint per `CLAUDE.md` § Session handoff protocol:
- After opening or merging a PR
- After a major product decision
- After a BMAD phase completes
- Before a long subagent dispatch
- When conversation feels dense (5+ tool calls in a turn, or many exchanges)
- When Gili types `/checkpoint`

The goal: a fresh session reads this file in 30 seconds and knows the state.
