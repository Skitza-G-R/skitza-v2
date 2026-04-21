---
description: Scan all project .md files and report any drift from the documentation rules defined in CLAUDE.md and docs/INDEX.md
---

You are auditing the Skitza documentation for drift from the rules defined in `CLAUDE.md` → "Documentation rules" and `docs/INDEX.md` → "Where things live". Report concisely; do NOT fix anything unless the user asks.

## Scan + report

Run these checks in order and report findings as a prioritized list (🔴 violations → 🟡 warnings → 🟢 clean).

### 🔴 Rule 1 — No loose .md files at repo root

Allowed at root: `README.md`, `CLAUDE.md`. Anything else is a violation.

```bash
ls *.md 2>/dev/null | grep -v '^README.md$' | grep -v '^CLAUDE.md$'
```

Report any matches as: "🔴 Stray root .md: `<filename>` — should live in `docs/`".

### 🔴 Rule 2 — Shipped plans in active/

A plan in `docs/plans/active/` whose feature branch has been merged to main should be moved to `docs/plans/archive/`. Heuristic: if the plan references a commit or branch that's already on main, it's shipped.

```bash
ls docs/plans/active/*.md 2>/dev/null
```

For each file, check whether its topic (inferred from the filename/date) corresponds to work that's already on main. Examples:
- If `2026-04-20-join-flow-architecture.md` is in active/ but all 5 /join-flow commits are on main → 🔴 move to archive/.
- If a file in active/ is unmodified in the last 30 days AND its branch is merged → 🔴 move to archive/.

### 🔴 Rule 3 — Loose plans directly in docs/plans/

```bash
ls docs/plans/*.md 2>/dev/null
```

Any `.md` file directly in `docs/plans/` (not in `active/`, `archive/`, or `stories/`) is a violation. Report as: "🔴 Un-categorized plan: `<filename>` — should move to active/ or archive/".

### 🟡 Rule 4 — PRD vs CLAUDE.md drift check

Grep for product rules that might be duplicated between `PRD.md` and `CLAUDE.md`. Specifically:
- Pricing mentions in both
- Tech stack lists in both
- "Product decisions" enumeration in both

```bash
grep -l "Pro tier\|Free tier\|platform fee\|custom domain" CLAUDE.md
grep -l "Tech stack\|Next.js 15\|Drizzle ORM\|Clerk v7" CLAUDE.md
```

If CLAUDE.md has any content that also lives in PRD.md, flag as: "🟡 Potential drift risk: `<topic>` mentioned in both CLAUDE.md line X and PRD.md line Y. Consider removing from CLAUDE.md and linking to PRD."

### 🟡 Rule 5 — Stories folder orphans

`docs/plans/active/*.md` and `docs/plans/archive/*.md` often reference per-story files at `docs/plans/stories/<name>.md`. Detect references that don't resolve:

```bash
grep -r "docs/plans/stories/" docs/plans/ | grep -oE "docs/plans/stories/[a-z0-9-]+\.md"
```

For each referenced file, check if it exists. If not: "🟡 Broken story reference: `<plan>` mentions `<story-file>` but it doesn't exist."

### 🟡 Rule 6 — Outdated dates in INDEX.md

`docs/INDEX.md` has a "Current active work (as of YYYY-MM-DD)" date. If that date is more than 7 days stale compared to today, report: "🟡 INDEX.md 'Current active work' date is stale — update it."

### 🟢 Green — nothing else to report

If no violations or warnings, print: "🟢 Docs clean. No drift detected."

## Final summary format

```
📋 Docs audit — <today's date>

🔴 Violations: <count>
<list>

🟡 Warnings: <count>
<list>

🟢 Clean checks: <count of rules that passed>
```

## If the user asks you to fix

Propose specific `git mv` / edit operations. Do NOT execute them without explicit "go". Rename commits should use the prefix `docs(cleanup):`.
