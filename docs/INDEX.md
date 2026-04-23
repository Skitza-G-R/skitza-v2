# Skitza — Documentation Index

> **For Claude:** This is the master map of all Skitza documentation. If you're starting a fresh session, read this file first — then `/CLAUDE.md` and `docs/product/PRD.md`. Between these three, you have the full project state.

> **For humans:** This is the front door. Every doc you might need, organized by purpose. Start here.

---

## 🚨 Read first, every session

**[`session_recap.md`](session_recap.md)** — live handoff snapshot. Current branch, what just finished, what's next. Overwritten at every checkpoint. If you read only one thing before picking up work, read this.

**[`audit-report.md`](audit-report.md)** — live paper trail for the 2026-04-22 codebase audit. 17 tracked tasks with per-task fix logs. Every fix must flip its row from ⏳ Pending → ✅ Fixed and append to the task's Fix Log. If you're about to touch a known bug, start here so you don't duplicate work.

**[`qa/2026-04-23-overnight-prs-audit.md`](qa/2026-04-23-overnight-prs-audit.md)** — pre-merge verification of overnight PRs #32-36. Read this before merging any of them. Includes recommended merge sequence + post-merge checklist.

**[`qa/2026-04-23-observability-verification.md`](qa/2026-04-23-observability-verification.md)** — post-merge confirmation that Sentry + PostHog are live on prod (migrations applied, env vars set, real pageview traced). Bookend to the pre-merge audit.

**[`contributor-onboarding.md`](contributor-onboarding.md)** — everything a new developer needs to know before starting: product shape, tech stack, crucial flows, how we work (BMAD + TDD), conventions, tribal knowledge. Share this with any collaborator on day 1.

## 🎯 The canonical files

| File | What it is | When to read |
|---|---|---|
| **[session_recap.md](session_recap.md)** | Live handoff. Current state as of last checkpoint. | **Every session start.** |
| **[contributor-onboarding.md](contributor-onboarding.md)** | Day-1 onboarding for new developers — tech stack, flows, conventions, tribal knowledge. | **Day 1 for any new human contributor.** |
| **[audit-report.md](audit-report.md)** | Paper trail of all known bugs + fixes from 2026-04-22 audit. | Before fixing anything, and immediately after you fix something (to update status). |
| **[PRD.md](product/PRD.md)** | Product spec. WHAT we build. 27 sections, 70+ locked decisions. **Normative.** | Any time a product question comes up. |
| **[CLAUDE.md](../CLAUDE.md)** | Claude's conventions. HOW we work. Commands, mistake log, file rules. | Auto-loaded every session. |
| **[bmad-workflow.md](bmad-workflow.md)** | Playbook for collaborating with Claude via BMAD — phases, magic phrases, tracks. | When Gili asks for a feature or fix. |
| **[decisions/360-prd-answers.md](decisions/360-prd-answers.md)** | WHY the PRD says what it says — the Socratic Q&A journey behind every locked decision. | When you need to understand reasoning behind a PRD choice. |

---

## 🏗️ Documentation architecture

```
/
├── README.md                    ← public-facing pitch + link here
├── CLAUDE.md                    ← HOW we work (conventions, commands, mistakes)
└── docs/
    ├── INDEX.md                 ← this file (master map)
    ├── session_recap.md         ← LIVE handoff state (read first, every session)
    ├── product/
    │   └── PRD.md               ← WHAT we build (canonical spec)
    ├── decisions/
    │   └── 360-prd-answers.md   ← WHY (Q&A that produced PRD)
    ├── plans/
    │   ├── active/              ← current work
    │   ├── archive/              ← shipped plans (historical)
    │   └── stories/             ← per-story artifacts (one folder per plan)
    ├── qa/                      ← phase review artifacts
    └── master-plan/             ← cross-batch followups (historical)
```

---

## 📂 Where things live — the rules

### New plan? → `docs/plans/active/<YYYY-MM-DD>-<slug>.md`
Paired design doc, if any, goes next to it: `<YYYY-MM-DD>-<slug>-design.md`.

### Plan's PR merges? → `git mv` the file to `docs/plans/archive/`
**This is the single most important rule.** A plan that shipped is historical. It should not pollute the active folder.

### New product decision? → Update `docs/product/PRD.md`
Do NOT update CLAUDE.md with product rules. They will drift.

If the decision came out of a structured Q&A, append the Q&A to `docs/decisions/360-prd-answers.md` so the *why* is preserved.

### New convention / mistake lesson / command? → Update `CLAUDE.md`
Do NOT update PRD.md with how-we-work stuff.

### Anything at the repo root?
**No.** The only `.md` files at the repo root are `README.md` and `CLAUDE.md`. Anything else belongs in `docs/`.

---

## 🛠️ Current active work (as of 2026-04-22)

- **Active branch**: `fix/audit-tasks-2-15-artist-signup` — audit Tasks 1 + 2 + 15 + 16 shipped; Task 17 design brief awaiting Gili's approval.
- **Open PR**: [#30 — audit Tasks 2 + 15 + 16](https://github.com/giasraf/skitza-v2/pull/30). Preview URL auto-updates per push.
- **Active plans**:
  - [2026-04-22 Artist UI rebuild — design brief](plans/active/2026-04-22-artist-ui-rebuild-design.md) (Task 17 — pending Gili's approval before implementation)
  - [2026-04-21 Post-launch roadmap](plans/active/2026-04-21-post-launch-roadmap.md) (12-week execution plan)
- **Audit status** (from [`audit-report.md`](audit-report.md)):
  - ✅ Fixed: Tasks 1, 2, 15, 16 (2026-04-22)
  - 📐 Design-phase: Task 17
  - ⏳ Pending: Tasks 3-14 (see audit-report for severity + priority)

---

## 🚀 Launch context (2026-04-21 → 2026-05-18)

30-day launch plan (week-banded). Current: Week 1.

- **Week 1** (Apr 21–27) — Infrastructure + Gili as Producer #0
- **Week 2** (Apr 28–May 4) — Core-loop polish (Setup tabs inline, onboarding wizard, Sentry + PostHog, ToS/Privacy)
- **Week 3** (May 5–11) — First 5 producers onboarded
- **Week 4** (May 12–18) — Soft launch

Full plan: [memory](`~/.claude/projects/-Users-giliasraf-Skitza-16-4/memory/project_30_day_launch_plan.md`) — off-repo, session-persistent.

---

## 🧠 Memory system (off-repo)

Claude's persistent memory lives at **`~/.claude/projects/-Users-giliasraf-Skitza-16-4/memory/`** and auto-loads via `MEMORY.md` at session start. Indexed memory files cover:

- **User role** — Gili is non-dev, needs plain English
- **BMAD auto-enforcement** — product-change requests must go through BMAD
- **Git discipline** — never `--amend`, frequent small commits
- **Documentation hygiene** — the rules in this file, saved as a feedback memory
- **/join Wave 1 status** — 5 commits code-complete on `feat/join-flow`
- **Strategic inventory** — 4 hard blockers (answered), 12 open questions, 5-BMAD order of operations
- **30-day launch plan** — the Apr 21 → May 18 week-banded roadmap
- **360° PRD answers** — complete Q&A log (70+ answers) — also mirrored in this repo as [`docs/decisions/360-prd-answers.md`](decisions/360-prd-answers.md)

**Rule**: memory files capture conversation outcomes (preferences, reasoning, moments). Repo docs capture normative decisions. When a memory entry pins a product rule, that rule must also live in PRD.md. The memory explains; the PRD commits.

---

## 📏 Hygiene

Run **`/docs-audit`** any time to check for drift between these rules and the actual state of the repo. It scans all `.md` files and reports anything out of place.

---

## 📚 Historical reference

- [`docs/plans/archive/`](plans/archive/) — 18 shipped plans, dated 2026-04-16 → 2026-04-19. Kept for reasoning-trace only.
- [`docs/qa/`](qa/) — phase + pre-merge review artifacts:
  - [`2026-04-23-observability-verification.md`](qa/2026-04-23-observability-verification.md) — post-merge confirmation Sentry + PostHog are live on prod
  - [`2026-04-23-overnight-prs-audit.md`](qa/2026-04-23-overnight-prs-audit.md) — pre-merge verification of overnight PRs #32-36 + codebase health check
  - `2026-04-17-phase-{c,d,e}-structural.md` — earlier phase reviews
- [`docs/master-plan/`](master-plan/) — cross-batch followup notes.

These don't need to be read during a normal session. They're preserved so we can reconstruct *why* something was done if needed months later.
