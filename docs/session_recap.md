# Session Recap — Live Handoff State

> **READ THIS FIRST at the start of every session.** Overwrite, never append. `git log` preserves history.

---

## 🕐 Last checkpoint

**2026-04-22 — AFK sprint 2 complete.** 5 PRs merged to main during this session. 1 new Wave 2 S04 Part 2 PR opened (#28) with 612 tests passing. Awaiting Gili to run `/skitza-migrate` and review #28.

---

## 👋 To the fresh Claude reading this

Don't re-execute shipped work. Check state: `git fetch && gh pr list --state open` + `git log --oneline origin/main -15`. BMAD hook is active on main — any product-change request fires Analyst first.

---

## ✅ What just happened (2026-04-22 session)

- **Merged 5 PRs to main**: #25 (Round 2 + roadmap), #26 (PRD §4.5 wizard), #21 (Wave 1 /join), #22 (Autopilot gating), #27 (Wave 2 S04 backend)
- **Replaced 3 PRs via rebase-onto-main** to fix squash-merge aftermath conflicts: #19→#25, #20→#26, #23→#27
- **Closed #24** (obsolete recap checkpoint)
- **PR #28 opened**: S04 Part 2 — 7 platform embed parsers (TDD, 29 tests) + `<ExternalLinkEmbed>` + `<ExternalLinksSection>` rendered on /join page. Total 612 tests green.
- **Migration 0031 NOT yet applied to prod** — sandbox blocked the production DB call; Gili must run `/skitza-migrate`

---

## 📍 Current state

| Thing | State |
|---|---|
| Main head | Has #25 → #26 → #21 → #22 → #27 (most recent: Wave 2 S04 backend) |
| Working branch | `feat/join-wave-2-embeds` (local, pushed as PR #28) |
| Open PR | **#28** (Wave 2 S04 Part 2 — embeds + /join integration) |
| Test count | 612 passing, 4 skipped |
| **🔴 Blocker** | `/skitza-migrate` must run — without it, /join/<slug> page errors on external-links query |
| Launch clock | Day 2 of 12-week roadmap (breakeven target July 10) |

---

## 🎯 What's next (in order)

### 👤 Gili actions required
1. **Run `/skitza-migrate`** in terminal — applies migration 0031 to prod (producer_external_links table)
2. **Merge PR #28** — Wave 2 S04 Part 2 (embeds + /join render)
3. **Fix GitHub Actions billing** (optional) — CI currently fails "account payments failed"; merges work but no auto-test

### 🤖 Claude actions (after above, pick one)
- **S04 Part 3 — Setup UI** for adding/removing/reordering external links (biggest missing piece of Wave 2)
- **S05 — Welcome splash** post-signup + producer auto-attach refinement
- **S2.2 Resend wiring** — 10 email triggers (needs `RESEND_API_KEY`)
- **S2.3 Sentry + PostHog install** (needs env vars)

---

## 🧠 Context that matters

- **Runway: 3 months** — revenue by July 2026, breakeven = 100 producers × $29
- **Gili is non-dev** — plain English always
- **BMAD mandatory** via hook — fires on every product-change request
- **Gili's pattern**: simpler/cheaper/tighter when options are close
- **עוסק פטור** registration is the single biggest timeline risk (gates Stripe Connect)
- **Pricing**: Free + Pro $29, 5% fee, beta "pay what you want" + 6mo grandfather
- **English-only launch** (no Hebrew UI)
- **Autopilot**: 2 toggles active, 3 "Coming soon" (hidden per PRD §15.1)
- **Content commitment**: 1 reel/week + 1 blog/week + 1 YouTube/month (~4-5hr/week Gili time)

---

## 🔑 How to resume from cold

1. Read this file (you're here)
2. CLAUDE.md auto-loads
3. `git fetch && gh pr list --state open && git log --oneline origin/main -15`
4. Default: ensure #28 merged + migrate ran, then pick next Phase 2 story
5. Any product change → BMAD Analyst first (hook fires reminder)

---

## 📋 Files to glance at

- [docs/plans/active/2026-04-21-post-launch-roadmap.md](plans/active/2026-04-21-post-launch-roadmap.md) — **12-week plan**
- [docs/decisions/360-prd-answers.md](decisions/360-prd-answers.md) — 115+ product decisions + reasoning
- [docs/product/PRD.md](product/PRD.md) — normative spec (+ §4.5 wizard, §7.1 beta pricing, §15.1-2 Autopilot, §22.2b paging, §28 GTM)
- [docs/INDEX.md](INDEX.md) — master map

---

## 🧹 Update discipline

Overwrite, never append. Trigger: after PR merge, major decision, BMAD phase complete, dense conversation, `/checkpoint`.
