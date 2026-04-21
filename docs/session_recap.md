# Session Recap — Live Handoff State

> **READ THIS FIRST at the start of every session.** This file is a rolling snapshot of the current project state. It's overwritten at every checkpoint so it always reflects "right now." If you need history, `git log` this file.
>
> **For Claude**: you are required to update this file at natural checkpoints (see `CLAUDE.md` § Session handoff protocol). For the user: this is the answer to "where did we stop?"

---

## 🕐 Last checkpoint

**2026-04-21 — AFK-autopilot sprint: 3 PRs up while Gili is away. TDD green. Awaiting review.**

---

## ✅ What we just finished (this AFK sprint)

- **PR #21 `feat/join-flow`** — Wave 1 of /join, code-complete, 4 commits after rebase on fresh main. 560 tests passing.
- **PR #22 `feat/autopilot-gating`** — S2.6 from the roadmap. Autopilot UI now shows 2 working toggles + 3 "Coming soon" stubs (per PRD §15.1). 6 TDD tests.
- **PR #23 `feat/join-wave-2-external-links`** — S2.1-S04 BACKEND slice. Migration 0031 + `producerExternalLinks` tRPC CRUD + `publicProfile.forJoin` returns real links. 17 TDD tests. Based on `feat/join-flow` (retarget to main after #21 merges).
- **577 tests passing overall** (560 baseline + 17 new), typecheck + lint clean on every PR.

---

## 📍 Current state

| Thing | State |
|---|---|
| **Main** | has docs/cleanup (#18) + BMAD skill (#17) |
| **Open PRs awaiting Gili** | **#19** Round 2 docs · **#20** PRD §4.5 · **#21** Wave 1 /join · **#22** Autopilot gating · **#23** Wave 2 S04 backend |
| **Working branch** | `feat/join-wave-2-external-links` |
| **Stash** | empty (dropped earlier) |
| **BMAD** | active on main (enforcement via `.claude/hooks/bmad-enforce.sh`) |
| **Launch clock** | Day 1 of 12-week roadmap. Revenue target July 10. |

---

## 🎯 What's next (in order)

1. **Gili reviews + merges PRs 19, 20, 21, 22, 23** (in order — each depends on the prior when chained). Recommended: #19 → #21 → #22/#23 retarget to main → #20.
2. **Run `/skitza-migrate`** after #23 merges to apply migration 0031 to prod.
3. **S04 Part 2 (next PR after merge)**: Setup UI external-links picker + 7 per-platform embed components + /join page Section B render.
4. **S2.2 Resend wiring** (10 email triggers from PRD §14).
5. **S2.3 Sentry + PostHog install** — needs env vars.
6. **S2.5 Legal pages** — ToS + Privacy + Cookie banner + /refund-policy. Needs Gili to review.
7. Continue Phase 2 → 3 → 4 of the post-launch roadmap.

---

## 🧠 Context that matters right now

- **🔴 Runway: 3 months** — revenue by July 2026.
- **Gili is non-dev** — plain English required.
- **BMAD active** — any product-change request must go through Analyst phase first (enforced by hook).
- **Gili's pattern**: simpler/cheaper/tighter when options are close.
- **עוסק פטור registration** is the single biggest timeline risk (gates Stripe Connect).
- **Producer #0 content** still placeholder (Gili's own tracks not uploaded).

---

## 🔑 How to resume from cold

1. Read this file (you're here).
2. Read [CLAUDE.md](../CLAUDE.md) — auto-loaded.
3. Read [docs/INDEX.md](INDEX.md) for the map.
4. Run `git status && gh pr list --state open`.
5. Default next action: wait for merges. When #19/#21 merge, retarget #22/#23 to main. When all merged, execute S04 Part 2 or S2.2 Resend.

---

## 📋 Files to glance at if diving back in

- **PR #23** (most-recent work): https://github.com/giasraf/skitza-v2/pull/23
- [docs/plans/active/2026-04-21-post-launch-roadmap.md](plans/active/2026-04-21-post-launch-roadmap.md) — THE 12-week plan
- [docs/decisions/360-prd-answers.md](decisions/360-prd-answers.md) — Round 1 + 2 reasoning trace
- [docs/product/PRD.md](product/PRD.md) — spec with new §7.1 / §15.1-2 / §22.2b / §28
- [docs/INDEX.md](INDEX.md) — master map

---

## 🧹 Update discipline

Overwrite, never append. Update at every natural checkpoint per CLAUDE.md § Session handoff protocol.
