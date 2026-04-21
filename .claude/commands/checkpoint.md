---
description: Save a session checkpoint — update docs/session_recap.md with the latest state so a fresh session can resume cleanly
---

You are saving a handoff checkpoint so a future Claude (in a new session, possibly after a context reset) can pick up exactly where we left off.

## Task

Update `docs/session_recap.md` to reflect the current state of the project. **Overwrite** the content — this file is a snapshot, not an append log.

## Gather the state

Run these in parallel:

```bash
git status --short
git log --oneline -10
git stash list
git branch --show-current
gh pr list --state open --limit 10
```

Use the output to fill in the sections below.

## Required sections (preserve this order)

1. **Last checkpoint** — today's date.
2. **What we just finished** — 2-5 bullets summarizing the most recent completed work.
3. **Current state** — branch, working-tree state, stash, unpushed commits, unmerged feature branches, open PRs.
4. **What's next** — ordered list of next steps (immediate first).
5. **Context that matters right now** — user preferences, active blockers, non-obvious facts a fresh session would miss.
6. **How to resume from cold** — 5-step sequence a fresh session should follow.
7. **Files to glance at** — 3-6 file paths that matter most for the current work.
8. **Update discipline** (keep the existing reminder block at the bottom unchanged).

## Constraints

- Total length: ~80 lines max. If it's longer, trim details — detail goes in plans/PRD/memory.
- Keep the file front-matter comment at the top.
- Do NOT append — fully rewrite the state sections.

## After saving

Commit with message: `docs(recap): checkpoint — <one-line summary>` and push to the current branch if it's not main. Do NOT auto-merge or open a PR.

Report back: "Checkpoint saved. Key next step: <first item from What's next>."
