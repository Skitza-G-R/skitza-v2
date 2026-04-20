---
name: bmad
description: Use when starting any meaningful feature or initiative on Skitza. Orchestrates a multi-phase workflow (Analyst → PM → Architect → SM → Dev → QA) that produces feature brief → epic → stories → implementation. Adapted from the BMAD Method (Breakthrough Method for Agile AI-Driven Development, Boris Cherny + bmad-code-org) for Skitza's existing CLAUDE.md + PRD v2 + subagent-driven patterns.
---

# BMAD for Skitza

## What this is

BMAD (Breakthrough Method for Agile AI-Driven Development) is a staged workflow where Claude plays different specialist roles — each in a **fresh context** with a **well-defined input** and a **well-defined output** — so complex features ship correctly the first time without re-derivation, hallucination, or scope drift.

**Standard BMAD** has 8 agent roles (Analyst / PM / PO / UX / Architect / SM / Dev / QA) and produces 6 artifact types per feature.

**Skitza-BMAD** (this skill) is a lean adaptation:

- 5 practical roles that match the solo-founder + subagent-driven reality
- Reuses the existing `docs/plans/` + `docs/product/PRD.md` + `CLAUDE.md` structure (no new `_bmad-output/` directory)
- Dispatches the existing Skitza subagents (`skitza-tdd-implementer`, `skitza-ux-critic`) for the Dev + QA roles
- Scales the process: tiny fixes skip most phases; real features do all of them

## When to use this skill

**Always** when the user asks for:
- A new feature of any meaningful size (anything a 1-day task or larger)
- "Let's ship X" or "I want to add X"
- A refactor that touches > 3 files
- Anything where the user says "think about" or "come up with a plan"

**Skip to direct work** (don't invoke this skill) when:
- Single-line typo fix
- Obvious bug where the diagnosis is already clear
- Pure mechanical task (rename, extract utility, format)

## The 3 tracks — pick by complexity

Each track is a **preset** of which phases run. Pick at the start based on the ask's scope.

| Track | When | Phases | Artifact count |
|---|---|---|---|
| **Quick** | 1-file fix, copy tweak, small UI tweak | Skip to Dev | None (just a commit) |
| **Standard** | Feature spanning 2-10 files, touches UI or backend or both | Brief → Architecture lite → Story → Dev → QA | 3 docs + code |
| **Large** | New major surface, new tRPC procedures, schema change, multi-sub-tab | Brief → PRD section update → Architecture → Epic + Stories → Dev (per story) → QA | 4-6 docs + code per story |

**Default to Standard** unless the user's ask is explicitly trivial or sweeping.

## The 5 roles

Each role is a mental mode + its outputs. For Large track, each role runs in a **fresh subagent** so the context is clean. For Standard, they can run in sequence in the current chat.

### 1. Analyst (optional)

**When to run:** only when the user's ask has genuine open product questions.
**Output:** `docs/plans/YYYY-MM-DD-<feature>-brief.md` — a 1-page "why + what + success-criteria" doc.
**Skitza-specific:** read `CLAUDE.md` + `docs/product/PRD.md` first; the PRD already answers most "what should this do" questions. The Analyst's job is to identify what's NOT in the PRD yet.
**Questions the Analyst asks the user (Socratic style, 3-5 max):**
- Who is this for? (Producer? Artist? Visitor?)
- What's the success signal? (How do we know it worked?)
- What's the hard constraint? (What can't we break?)

### 2. PM — Product Manager

**When to run:** Standard + Large tracks.
**Output:**
- For Standard: a "PRD delta" — a new paragraph or subsection in `docs/product/PRD.md` capturing the feature's product intent.
- For Large: one or more new sections in `docs/product/PRD.md` + an epic file at `docs/plans/epics/<feature>-epic.md`.
**Skitza-specific:** the PRD is the canonical source of product truth. Don't write a separate spec — update the PRD.
**Handoff:** PRD delta is committed on its own feature branch BEFORE any code. The commit message reads `docs(prd): <feature> — product decisions`.

### 3. Architect — Technical design

**When to run:** Standard (lite) + Large (full).
**Output:**
- For Standard: an "Architecture lite" subsection inside the plan doc at `docs/plans/YYYY-MM-DD-<feature>.md` — 5-10 bullets covering tRPC shape, DB changes, component tree, test strategy.
- For Large: a standalone `docs/plans/YYYY-MM-DD-<feature>-architecture.md` that walks through: data model changes (schema + migration numbers), tRPC procedure shapes + auth scoping, UI component tree + subagent division, test strategy (including `findPredicate` assertions), edge cases, rollout plan.
**Skitza-specific:** always cite the `@skitza/db` schema.ts directly; never invent enum values (see CLAUDE.md's mistake log — this has burned us). Always specify migration workflow as `/skitza-migrate` (the direct-SQL path), not `drizzle-kit migrate`.

### 4. Scrum Master — Story breakdown

**When to run:** Large track only. For Standard, the plan doc IS the stories.
**Output:** individual story files at `docs/plans/stories/<feature>-<NN>-<title>.md`.
**Story template** (see `.claude/skills/bmad/templates/story.md` for the full form):
- ID + epic reference
- User story statement
- Acceptance criteria as a checklist (bullets Claude can tick)
- Technical context (pulled from the architecture doc — specific file paths, type names)
- TDD steps (red → green → refactor + exact test assertions)
- Commit message

**Skitza-specific:** each story is designed to be one self-contained subagent dispatch. No "story depends on story N-1 being merged first" — stories land on the same feature branch in sequence but each is independently reviewable.

### 5. Dev + QA — Implementation

**Dev:** existing `skitza-tdd-implementer` subagent (see `.claude/agents/skitza-tdd-implementer.md`).
- Reads the story file
- Writes failing test, captures RED output
- Implements, verifies GREEN
- Runs `/skitza-verify`
- Commits with the exact message from the story

**QA:** two-stage review per task:
1. Spec-compliance review (dispatch `general-purpose` subagent) — did the Dev build exactly what the story specified, nothing more, nothing less?
2. Code-quality review (dispatch `skitza-ux-critic` for UI work, `general-purpose` for backend) — is it well-built? Samply/Spotify benchmark for UI surfaces?

**Loop:** if QA finds issues, same Dev subagent fixes, QA reviews again. No "close enough."

## Phase flow

```
 ┌─────────────────────────────────────────────────────┐
 │  1. PICK A TRACK (Quick / Standard / Large)         │
 └─────────────────────────────────────────────────────┘
                   │
                   ▼
 ┌─────────────────────────────────────────────────────┐
 │  2. ANALYST (optional)                              │
 │     → docs/plans/<date>-<feature>-brief.md          │
 └─────────────────────────────────────────────────────┘
                   │
                   ▼
 ┌─────────────────────────────────────────────────────┐
 │  3. PM — update PRD                                 │
 │     → docs/product/PRD.md (new section or delta)    │
 │     COMMIT: docs(prd): <feature>                    │
 └─────────────────────────────────────────────────────┘
                   │
                   ▼
 ┌─────────────────────────────────────────────────────┐
 │  4. ARCHITECT                                       │
 │     Standard → "Architecture lite" inside plan doc  │
 │     Large    → docs/plans/<date>-<feature>-arch.md  │
 └─────────────────────────────────────────────────────┘
                   │
                   ▼
 ┌─────────────────────────────────────────────────────┐
 │  5. SM — story breakdown (Large only)               │
 │     → docs/plans/stories/<feature>-NN-<title>.md    │
 └─────────────────────────────────────────────────────┘
                   │
                   ▼
 ┌─────────────────────────────────────────────────────┐
 │  6. DEV (TDD loop per story)                        │
 │     Fresh subagent per story                        │
 │     → skitza-tdd-implementer                        │
 └─────────────────────────────────────────────────────┘
                   │
                   ▼
 ┌─────────────────────────────────────────────────────┐
 │  7. QA (per story)                                  │
 │     Spec-compliance → code-quality (+ skitza-ux-    │
 │     critic if UI)                                   │
 └─────────────────────────────────────────────────────┘
                   │
                   ▼
 ┌─────────────────────────────────────────────────────┐
 │  8. INTEGRATION                                     │
 │     /skitza-verify → push branch → open PR          │
 └─────────────────────────────────────────────────────┘
```

## Critical rules ("always do this")

1. **Read `CLAUDE.md` + `docs/product/PRD.md` at the start of phase 2 (PM)**. The PRD has 70+ locked decisions; don't re-derive them.
2. **Fresh subagent per Dev story**. Context rot is the #1 BMAD failure mode.
3. **PM commits the PRD delta BEFORE any code lands**. This locks product intent in git so subsequent code reviews have a reference.
4. **Architect cites specific schema.ts types + file paths**. Never invent.
5. **Stories are self-contained**. Each includes all the context a fresh subagent needs.
6. **No `--amend`**. New commits for every fix (per CLAUDE.md commit discipline).
7. **Every commit message** uses `feat(scope):` / `fix(scope):` / `docs(prd):` / `refactor(scope):` prefixes.
8. **Verify between roles**. `/skitza-verify` after each Dev story; don't batch.
9. **Update PRD's running mistake log** in CLAUDE.md whenever a surprise surfaces — this is how the method compounds.

## Role activation syntax

When the user says "let's use BMAD on <feature>" or this skill is invoked, Claude announces the phase + role, asks the minimum questions to proceed, and produces the artifact.

| Phase | Announce |
|---|---|
| 1 | "Running BMAD in <track> track on `<feature>`. Picking Analyst first — [3 questions]." |
| 2 | "Switching to PM role. Reading PRD + CLAUDE.md... [proposing PRD delta]." |
| 3 | "Switching to Architect. [technical design following]." |
| 4 | "Switching to SM — breaking down into N stories." |
| 5 | "Dispatching Dev subagent for story `<NN>`." |
| 6 | "Dispatching QA review." |
| 7 | "Integration: /skitza-verify → branch → PR." |

## Track-specific cheat sheet

### Quick track (trivial)

```
Skip to Dev. Maybe update mistake log in CLAUDE.md if the fix reveals a pattern.
```

### Standard track (most features)

```
1. (optional) 3-question Analyst interview  →  docs/plans/<date>-<feature>-brief.md
2. PM: 1-paragraph PRD delta                 →  docs/product/PRD.md  (commit: docs(prd):)
3. Architect-lite: 10 bullets in plan doc    →  docs/plans/<date>-<feature>.md
4. Dev: TDD loop via skitza-tdd-implementer
5. QA: spec + quality review
6. /skitza-verify → push → PR
```

### Large track (new surface / schema / multi-sub-tab)

```
1. Analyst: full 1-page brief              →  docs/plans/<date>-<feature>-brief.md
2. PM: new PRD section + epic file         →  docs/product/PRD.md + docs/plans/epics/<feature>-epic.md  (commit: docs(prd):)
3. Architect: standalone architecture doc  →  docs/plans/<date>-<feature>-architecture.md
4. SM: 5-15 story files                    →  docs/plans/stories/<feature>-NN-<title>.md
5. Dev (per story): fresh skitza-tdd-implementer subagent
6. QA (per story): spec + quality review
7. /skitza-verify → push → PR
```

## Anti-patterns to avoid

1. **Skipping the PRD update to "save time"** — always produces rework. 10 minutes on PRD saves an hour of "wait this wasn't what I meant."
2. **Dispatching Dev before Architect** — Dev will pick random conventions. Architect output IS the brief.
3. **One subagent doing all stories** — context rot by story 3. One story = one subagent.
4. **Silent code review failures** — if QA finds issues and Dev "fixes on their own," the review loop breaks. Always re-dispatch QA to verify.
5. **Writing a new PRD for every feature** — the PRD is one file. New features = new sections or deltas. The PRD is an evolving document.

## Integration with existing Skitza tooling

BMAD reuses:
- `CLAUDE.md` → session memory, conventions, mistake log
- `docs/product/PRD.md` → product source of truth
- `docs/plans/` → feature plans (existing convention)
- `.claude/agents/skitza-tdd-implementer.md` → the Dev role
- `.claude/agents/skitza-ux-critic.md` → the UI QA role
- `/skitza-verify` → pre-commit verification gate
- `/skitza-migrate` → migration workflow (bypasses the broken drizzle journal)
- `superpowers:subagent-driven-development` → parallel subagent pattern

New in BMAD:
- `.claude/skills/bmad/templates/` → Brief / Epic / Story templates
- Phase-based artifact hierarchy (Analyst/PM/Architect/SM outputs)
- Track selection (Quick / Standard / Large)
- Role announcement discipline ("Switching to PM role...")

## How the user works with Claude using BMAD

See `docs/bmad-workflow.md` (committed alongside this skill) for the user-facing guide — concrete examples of what the user says, what Claude produces, and how they iterate.

## References

- [BMAD-METHOD GitHub (official)](https://github.com/bmad-code-org/BMAD-METHOD)
- [BMAD docs](https://docs.bmad-method.org/)
- [Boris Cherny's Claude Code workflow](https://howborisusesclaudecode.com/) — the origin of many of these rituals
- Skitza internal: `CLAUDE.md` (conventions), `docs/product/PRD.md` (source of truth), `.claude/commands/skitza-*.md` (tooling)
