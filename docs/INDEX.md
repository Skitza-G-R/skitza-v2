# Skitza — Documentation Index

> **For Claude:** This is the master map of all Skitza documentation. If you're starting a fresh session, read this file first — then `/CLAUDE.md` and `docs/product/PRD.md`. Between these three, you have the full project state.

> **For humans:** This is the front door. Every doc you might need, organized by purpose. Start here.

---

## 🚨 Read first, every session

**[`session_recap.md`](session_recap.md)** — live handoff snapshot. Current branch, what just finished, what's next. Overwritten at every checkpoint. If you read only one thing before picking up work, read this.

## 🎯 The canonical files

| File | What it is | When to read |
|---|---|---|
| **[session_recap.md](session_recap.md)** | Live handoff. Current state as of last checkpoint. | **Every session start.** |
| **[PRD.md](product/PRD.md)** | Product spec. WHAT we build. 27 sections, 70+ locked decisions. **Normative.** | Any time a product question comes up. |
| **[CLAUDE.md](../CLAUDE.md)** | Claude's conventions. HOW we work. Commands, mistake log, file rules. | Auto-loaded every session. |
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

## 🛠️ Current active work (as of 2026-04-21)

- **Active branch**: `feat/join-flow` — /join flow Wave 1 shipped as 5 commits, unpushed, no PR yet
- **Active plan**: [/join flow architecture (Wave 1 done, Wave 2 pending)](plans/active/2026-04-20-join-flow-architecture.md)
- **Pending merge**: `feat/bmad-skill` — the BMAD enforcement layer (skill + hook + templates). Never merged to main. Merge this before starting the next product-change mission.
- **Uncommitted stashed work**: PRD §4.5 (Producer first-run onboarding wizard spec) + a 2,616-line rewrite of the dashboard refactor plan. Stashed under message `"prd-section-4.5 + dashboard-plan-rewrite"`. Each belongs on its own branch when the user is ready.

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
- [`docs/qa/`](qa/) — phase C / D / E structural reviews (2026-04-17).
- [`docs/master-plan/`](master-plan/) — cross-batch followup notes.

These don't need to be read during a normal session. They're preserved so we can reconstruct *why* something was done if needed months later.
