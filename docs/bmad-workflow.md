# Working with Claude on Skitza using BMAD

> This is your playbook. Read it once, bookmark it, use the phrases from it.
> Every time you feel like I'm "misunderstanding" or we're re-clarifying the same thing, I'm probably skipping a phase. Call it out with the phrases below.

---

## The mental model

Think of me as **5 specialists**, not one assistant:

1. **Analyst** — asks you "why + what + success" questions, writes a 1-page brief
2. **PM** — updates your PRD so the product intent is locked in git BEFORE code
3. **Architect** — designs the technical solution (files, types, tRPC, tests)
4. **Scrum Master** — breaks the Architect's design into self-contained stories
5. **Dev + QA** — implements each story in a fresh subagent, with review

Each specialist has **one job**, produces **one artifact**, and hands it to the next specialist. Like a factory assembly line — but at the speed of parallel AI.

**Why this works:** every time I "forgot the context" or "misunderstood the link flow," it was because I jumped straight to Dev without an Analyst/PM pass. The mistake encoded itself into code. With BMAD, intent is captured in writing (and committed to git) BEFORE any code is written.

---

## The 3 tracks — you pick, I run

At the start of any feature, you decide which track fits. If you don't say, I'll propose one.

### Quick (5 minutes)
For: typo fixes, one-line changes, obvious bugs.
You say: *"Quick fix: the share-link button's label should be 'Copy your link' not 'Copy link'."*
I do: just the change. No brief, no PRD. Commit with a clear message. Done.

### Standard (30-60 minutes)
For: most features. 2-10 files. New UI surface or small backend change.
You say: *"Standard BMAD: let's add a 'Quick note' modal to QuickActions."*
I do:
1. 3-question interview with you (Analyst)
2. Paragraph update to PRD (PM) → commit
3. 10-bullet architecture in the plan doc (Architect)
4. TDD loop via skitza-tdd-implementer (Dev)
5. Spec + code review (QA)
6. Verify + push + PR

### Large (hours, multiple subagent dispatches)
For: new major surface, new schema, new tRPC, multi-sub-tab.
You say: *"Large BMAD: build the /join/<slug> artist onboarding flow."*
I do:
1. Full 1-page brief (Analyst)
2. New PRD section + epic file (PM) → commit
3. Standalone architecture doc (Architect)
4. Break into 5-15 story files (Scrum Master)
5. For each story: fresh Dev subagent → QA review → fix loop
6. Verify + push + PR

---

## The magic phrases

These are the things to say to get me to do the right thing.

### Starting a feature

**"Quick BMAD: [thing]"** — skips straight to Dev for trivial work.

**"Standard BMAD: [thing]"** — default. Full phase flow, single-session.

**"Large BMAD: [thing]"** — big scope. Multiple subagent dispatches.

**"BMAD me: [thing]"** — don't know the size? I'll pick the track and tell you.

### Mid-feature

**"Switch to [role]"** — make me change mode explicitly. E.g., "switch to Architect — don't code yet."

**"Ask more questions"** — force another Analyst pass if I jumped past it.

**"Update the PRD first"** — reminds me to commit product intent before code.

**"Re-read CLAUDE.md"** — if I start making mistakes the mistake log already covers.

**"Brief this before you code"** — forces the Analyst phase even for what looks like a quick ask.

### Quality control

**"Re-dispatch QA"** — re-run spec + code review on the last story.

**"Show me the acceptance criteria"** — paste the story checklist so you can audit.

**"Run /skitza-verify"** — triggers the full verification pipeline.

**"Don't start Dev until Architect is committed"** — enforces the gate.

### When things go sideways

**"Rewind to [phase]"** — scrap current work, restart from an earlier phase.

**"Add to the mistake log"** — if you catch me in a recurring mistake, I encode it in CLAUDE.md so I can't repeat it.

**"Close the loop"** — means "verify + PR before you start the next thing." Prevents me from running away with 5 unfinished things.

---

## A concrete example — running Standard BMAD

Let's say you say: *"Standard BMAD: I want producers to be able to write a quick voice-memo-style note into the most recent project."*

### What happens

**Phase 1 — Analyst (2 min)**

I read CLAUDE.md + docs/product/PRD.md. I notice PRD §23.2 says voice-first is a non-goal (no API keys). I ask you 2-3 questions:

> - This is text-based "quick note," right? Voice input is deferred per PRD §23.2.
> - "Most recent project" = most recently updated, or most recently viewed?
> - Should the note be visible to the artist too, or producer-only?

You answer. I write a 12-line brief at `docs/plans/2026-04-20-quick-note-modal-brief.md`.

**Phase 2 — PM (1 min)**

I add a 3-line paragraph to PRD §4.1 (Today screen) capturing the Quick Note behavior. Commit: `docs(prd): Today Quick Note — persistence + visibility`.

You see the commit on the branch before any code. You can object now if I misunderstood.

**Phase 3 — Architect (3 min)**

I update the plan doc with architecture-lite:
- `trpc.project.addNote` — input `{ projectId, body }`, producer-scoped, inserts into existing `notifications` table (or a new `project_notes` if schema change warranted)
- UI: modal component at `apps/web/src/components/dashboard/today/quick-note-modal.tsx`, triggered from QuickActions
- Tests: router auth scope, modal rendering + submit behavior

**Phase 4 — Dev (5-10 min per commit)**

I dispatch `skitza-tdd-implementer` subagent:
- Writes failing test
- Captures RED output
- Implements
- Verifies GREEN
- Runs `/skitza-verify`
- Commits

**Phase 5 — QA (3 min)**

I dispatch spec-compliance review subagent, then `skitza-ux-critic` (since this has UI). Either ✅ or finds issues. If issues, same Dev subagent fixes.

**Phase 6 — Integration (1 min)**

`/skitza-verify` → push → open PR → paste the preview URL to you.

Total: ~20-30 minutes from ask to PR. You get to see intent committed (PRD + brief) and code committed (per-story) at each gate.

---

## What BMAD is NOT

- **Not a rigid waterfall.** You can skip Analyst if the ask is obvious. You can rewind at any phase.
- **Not heavy process for its own sake.** The Quick track exists for trivial work.
- **Not a replacement for CLAUDE.md or PRD.** It USES them. Everything BMAD produces lands in existing locations (`docs/plans/`, `docs/product/PRD.md`, `.claude/`).

---

## The 5 anti-patterns I've personally done to you

From the mistake log in CLAUDE.md. BMAD directly prevents each.

| Mistake | How BMAD prevents it |
|---|---|
| "You misunderstood the link flow 3 times" | Analyst phase forces 3-5 questions before any code |
| "Built a cross-link to a dead page" | Architect phase cites specific file paths + verifies they exist |
| "Dashboard crashed on `default_session_min` column" | Architect phase references schema.ts, never invents enums |
| "Ran `drizzle-kit migrate` that silently skipped migrations" | CLAUDE.md + the skill document the `/skitza-migrate` rule |
| "Scope-crept into 8 tasks when you asked for 1" | Story breakdown + self-contained subagents stop creep |

---

## Running BMAD via the skill

When you say one of the magic phrases above, Claude will announce the role explicitly:

> *"Running Standard BMAD on `quick-note-modal`. Picking Analyst first — 3 questions..."*

Each phase announcement is your checkpoint. If something seems off, interject. BMAD is collaborative — you're the product owner, I'm the factory floor.

---

## Quick reference card

```
┌──────────────────────────────────────────────────────────────┐
│  STARTING A FEATURE                                          │
│  "Standard BMAD: <thing>"                                    │
│                                                              │
│  PHASES (Standard)                                           │
│  1. Analyst  → 3 questions + brief                           │
│  2. PM       → PRD delta + commit                            │
│  3. Architect→ plan doc with architecture                    │
│  4. Dev      → skitza-tdd-implementer subagent               │
│  5. QA       → spec + code review                            │
│  6. Ship     → /skitza-verify → push → PR                    │
│                                                              │
│  INTERJECT ANY TIME                                          │
│  "Switch to <role>"                                          │
│  "Ask more questions"                                        │
│  "Update the PRD first"                                      │
│  "Rewind to <phase>"                                         │
│                                                              │
│  MISTAKE LOG: CLAUDE.md §Running mistake log                 │
│  PRODUCT TRUTH: docs/product/PRD.md                          │
│  VERIFY: /skitza-verify                                      │
└──────────────────────────────────────────────────────────────┘
```

---

Questions? Try BMAD on a small feature first to get the feel, then scale up.
