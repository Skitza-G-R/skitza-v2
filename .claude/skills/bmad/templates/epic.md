# Epic: [EPIC NAME]

> Skitza-BMAD · PM phase · Large track only
>
> **Saved to:** `docs/plans/epics/<feature>-epic.md`
> **PRD section:** §[N] (link/anchor)
> **Brief:** `docs/plans/YYYY-MM-DD-<feature>-brief.md`
> **Architecture:** `docs/plans/YYYY-MM-DD-<feature>-architecture.md`
> **Target branch:** `feat/<feature>`

---

## Goal

*One sentence: what this epic achieves at the user level.*

## User stories included

*Flat list — each story is implementable as one subagent dispatch.*

| # | Title | Story file | Est. commits |
|---|---|---|---|
| 01 | [title] | `docs/plans/stories/<feature>-01-<title>.md` | 1-2 |
| 02 | [title] | `docs/plans/stories/<feature>-02-<title>.md` | 1 |
| 03 | [title] | `docs/plans/stories/<feature>-03-<title>.md` | 2-3 |

## Dependency graph

*Which stories need to land before which. Keep flat when possible.*

```
01 ──▶ 02 ──▶ 03
              ├─▶ 04
              └─▶ 05
```

## Schema changes

*If any. Reference migration numbers.*

- `packages/db/drizzle/NNNN_<name>.sql` — [what it adds/changes]

## tRPC procedures (new or modified)

- `producer.<name>` — [new / modified]
- `artist.<name>` — [new / modified]

## UI surfaces touched

- `apps/web/src/app/(app)/dashboard/<path>` — [new / modified]
- `apps/web/src/components/<path>` — [new / modified]

## Testing strategy at the epic level

*Per-story tests are defined in each story; this section covers cross-story integration.*

- [ ] End-to-end flow test (manual checklist)
- [ ] Auth-scope boundary tests for new tRPC procs
- [ ] Mobile 360px sanity pass

## Definition of done

- All stories shipped + reviewed
- `/skitza-verify` clean
- PR opened with checklist
- Mistake log in `CLAUDE.md` updated if lessons emerged

## Rollout plan

*How this lands safely in production.*

- [ ] Migrations applied via `/skitza-migrate` (pre-deploy)
- [ ] Feature can be disabled via [flag / removing a route / etc.] if needed
- [ ] User-facing changelog entry
