# Story: [ID] — [TITLE]

> Skitza-BMAD · SM phase · One story = one subagent dispatch
>
> **Saved to:** `docs/plans/stories/<feature>-NN-<title>.md`
> **Epic:** `docs/plans/epics/<feature>-epic.md`
> **Architecture:** `docs/plans/YYYY-MM-DD-<feature>-architecture.md` — §[relevant section]
> **Depends on:** [story IDs that must land first, or "none"]

---

## As a [persona]...

...I want to [capability]

...so I can [outcome]

## Acceptance criteria

*Claude ticks these off as it implements. Each is a specific, testable behavior.*

- [ ] [Specific observable behavior #1]
- [ ] [Specific observable behavior #2]
- [ ] [Specific observable behavior #3]
- [ ] [Edge case handled]
- [ ] [a11y / mobile / RTL constraint]

## Technical context

*Everything the Dev subagent needs without re-exploring the codebase.*

### Files to touch

**Create:**
- `apps/web/src/<path>/<file>.ts` — [what lives here]
- `apps/web/src/<path>/<file>.test.ts` — [test coverage]

**Modify:**
- `apps/web/src/<path>/<existing>.tsx` — [what changes, at roughly line X]

**Delete:**
- [path] — [why]

### tRPC procedures

*If touching the server. Pull from Architecture doc.*

- `<router>.<procedure>` — Input: `<Zod schema>`, Output: `<shape>`, Auth: `[producerProcedure / artistProcedure / publicProcedure]`, WHERE scope: `eq(<table>.producerId, ctx.producerId)`.

### Schema changes

*If any. Reference migration number.*

- Migration: `packages/db/drizzle/NNNN_<name>.sql`
- Columns: [list]
- Apply via: `/skitza-migrate` (NOT `drizzle-kit migrate`)

### Conventions (reminder pulled from CLAUDE.md)

- CSS vars only, no hex (`rgb(var(--brand-primary))`)
- Tests beside code, mock-DB marker-object pattern, `findPredicate` for auth assertions
- `producerProcedure` / `artistProcedure` / `publicProcedure`
- No framer-motion — CSS primitives in globals.css

## TDD steps

### Step 1 — Write the failing test(s)

```ts
// <test file path + content>
```

Expected: FAIL with `<exact error message>`. Capture verbatim.

### Step 2 — Verify RED

```bash
cd apps/web && pnpm test <path-to-test>
```

### Step 3 — Implement

*High-level: what the minimal implementation does. Detail in the Files-to-touch section.*

### Step 4 — Verify GREEN

```bash
cd apps/web && pnpm test <path-to-test>
```

Expected: N passing, no new failures elsewhere.

### Step 5 — Verify full pipeline

```bash
/skitza-verify
```

Expected: typecheck + lint + full suite clean. Test count baseline + N new (or same if no new tests).

## Commit

```bash
git add <files>
git commit -m "$(cat <<'EOF'
feat(<scope>): <imperative title>

<Body — what + why. Reference epic + story ID. Note any deferred scope
or follow-ups.>

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## QA review checklist

*QA subagent uses this to verify spec compliance, then code quality.*

### Spec compliance

- [ ] All acceptance criteria actually met (run the flow mentally)
- [ ] Nothing built beyond what the story specified
- [ ] Auth scope correct (if tRPC)

### Code quality (and UX where applicable)

- [ ] CSS vars only
- [ ] ARIA IDs paired correctly (if tabs)
- [ ] 44px tap targets on mobile
- [ ] Respects `prefers-reduced-motion` (if animation)
- [ ] Commit message reads clearly, includes co-author line
- [ ] No `--amend` used, no `--no-verify`

## Report format (Dev subagent outputs this)

1. Files changed (added / modified / deleted)
2. RED output verbatim
3. GREEN output verbatim
4. `/skitza-verify` tail (typecheck / lint / test results)
5. Commit SHA
6. Deviations from the story + rationale (if any)
7. Follow-ups or surprises worth flagging
