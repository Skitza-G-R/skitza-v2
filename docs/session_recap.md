# Session Recap — Live Handoff State

> **READ THIS FIRST at the start of every session.** This file is a rolling snapshot of the current project state. It's overwritten at every checkpoint so it always reflects "right now." If you need history, `git log` this file.
>
> **For Claude**: you are required to update this file at natural checkpoints (see `CLAUDE.md` § Session handoff protocol). For the user: this is the answer to "where did we stop?"

---

## 🕐 Last checkpoint

**2026-04-21 — end of session. Gili is starting a fresh session. Full handoff state preserved below.**

---

## ✅ What we just finished

- **Documentation architecture fully restructured.** PR #18 (`docs/cleanup` branch) is open with 2 commits:
  1. `docs(cleanup)` — moved 18 shipped plans to `docs/plans/archive/`, created `INDEX.md`, created `decisions/` folder, trimmed CLAUDE.md duplication, added `/docs-audit` slash command.
  2. `docs(recap)` — added this file + `/checkpoint` slash command + CLAUDE.md § Session handoff protocol. The mechanism you're using right now.
- **Nine memory files** now live in `~/.claude/projects/-Users-giliasraf-Skitza-16-4/memory/` — indexed via `MEMORY.md` and auto-loaded every session. Covers: user role, BMAD enforcement rule, git discipline, unmerged BMAD branch, /join Wave 1 status, strategic inventory, 30-day launch plan, 360° PRD answers (70+), documentation hygiene, session recap protocol.
- **Three prevention layers** for docs drift: CLAUDE.md rules (auto-loaded), memory file (off-repo persistent), `/docs-audit` command (on-demand scan).

---

## 📍 Current state

| Thing | State |
|---|---|
| **Active branch** | `docs/cleanup` (pushed, PR #18 open) |
| **Working tree** | clean |
| **Stashed work** | `stash@{0}: prd-section-4.5 + dashboard-plan-rewrite` — 2 uncommitted files ready to put on their own branches after PR #18 merges |
| **Open PRs** | **#18** docs/cleanup (just shipped) · **#17** feat/bmad-skill (BMAD enforcement, needs merge) · **#16** fix/db-consolidate-deals-to-projects (already applied to prod via migration 0029 — PR can probably be closed/merged) · **#1** old Node 24 CI bump (probably stale) |
| **Unpushed commits** | 5 on `feat/join-flow` (/join flow Wave 1, code-complete, no PR yet) |
| **Launch clock** | Day 1 of Week 1 per 30-day launch plan (target: end of April / early May 2026) |

---

## 🎯 What's next (in order)

1. **User reviews + merges PR #18** (`docs/cleanup` → main) — docs cleanup + session recap protocol both land.
2. **Merge PR #17** (`feat/bmad-skill` → main) — activates BMAD auto-enforcement on main and all future branches cut from main.
3. **Close or merge PR #16** (the deals→projects migration fix — already applied to prod via direct SQL, verify PR doesn't need to re-run).
4. **Pop the stash** and split onto two new branches:
   - `docs/prd-onboarding-wizard` → PRD §4.5 addition (Producer first-run onboarding wizard spec)
   - `docs/dashboard-plan-rewrite` → the 2,616-line rewritten implementation plan
5. **Ship /join Wave 1**: push `feat/join-flow`, open PR, merge. Wave 1 is code-complete (5 commits) but never went live.
6. **Start Resend wiring** (Week 1 launch-plan item — wire 10 email triggers from PRD §14). Run BMAD Analyst phase first.

---

## 🧠 Context that matters right now

- **Gili is non-dev founder** — plain English required. No jargon without translation.
- **BMAD method must auto-fire** on any product-change request — BUT it's not active on main yet until PR #17 merges. Until then, run BMAD manually when product questions come up.
- **Gili's pattern**: prefers simpler / cheaper / tighter / more privacy-respecting. When options are close, bias that way.
- **Stripe Connect is blocked** on Israeli עוסק פטור tax registration. Until then: "Mark paid offline" fallback for all payments.
- **Infrastructure is live**: `skitza.app` domain + Vercel + `send.skitza.app` Resend verified. Producer #0 = Gili, but his profile content (bio / photo / 3-5 tracks) is not yet uploaded.
- **Gili just started a new session.** A fresh you is reading this file for the first time. Welcome back.

---

## 🔑 How to resume from cold

1. **Read this file** (you're here).
2. **Read [CLAUDE.md](../CLAUDE.md)** — auto-loaded anyway, but skim the § Documentation rules + § Session handoff protocol sections.
3. **Read [docs/INDEX.md](INDEX.md)** for the master map.
4. **Run these:**
   ```bash
   git status && git log --oneline -10 && git stash list
   gh pr list --state open
   ```
   Confirm the "Current state" table above matches reality. If drift, trust git over this file and update the recap.
5. **Ask Gili what he wants to do today.** Default recommendation: merge PR #18 first, then PR #17, then pop the stash. That gets the foundation clean before new work.

---

## 📋 Files to glance at if diving back in

- **PR #18** — https://github.com/giasraf/skitza-v2/pull/18 (docs cleanup + recap protocol)
- **PR #17** — https://github.com/giasraf/skitza-v2/pull/17 (BMAD enforcement layer)
- [`docs/INDEX.md`](INDEX.md) — master map of all docs
- [`docs/product/PRD.md`](product/PRD.md) — product spec (770 lines, 70+ locked decisions)
- [`docs/decisions/360-prd-answers.md`](decisions/360-prd-answers.md) — reasoning trace behind PRD
- [`docs/plans/active/2026-04-20-join-flow-architecture.md`](plans/active/2026-04-20-join-flow-architecture.md) — the only active plan (/join Wave 2 is pending here)
- Memory pointer: `~/.claude/projects/-Users-giliasraf-Skitza-16-4/memory/MEMORY.md` (auto-loaded, 10 pointers to file-specific memories)

---

## 🧹 Update discipline

**This file is overwritten, never appended.** If you're reading this and about to save a new checkpoint, REPLACE the content above with the latest state. `git log docs/session_recap.md` preserves every prior checkpoint.

### Update triggers (when to re-checkpoint — as Claude)

- After opening or merging a PR
- After a major product decision or tech pivot
- After a BMAD phase completes (Analyst → PM → Architect → SM → Dev → Ship)
- Before dispatching a long sequence of subagents
- When conversation feels long/dense (context reset may be near)
- When the user types `/checkpoint`

### Update format

Keep the structure above. Keep it under ~80 lines. The goal is "a fresh session can read this in 30 seconds and know exactly where to pick up." If it grows past 80 lines, trim — detail belongs in plans, PRD, or memory.
