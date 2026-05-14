# Clients & Projects Redesign — Phase 0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 6 additive database columns + 1 new enum (`workflow_stage`) so subsequent phases of the Clients & Projects redesign have the data they need. No UI changes ship in this phase. **Raz must review the PR before merge.**

**Architecture:** All changes are additive. The old `project.stage` enum stays untouched — billing keeps using it. The new `workflow_stage` enum + columns drive only the new UI in Phases 1-4. Drizzle schema + one SQL migration in `packages/db/drizzle/0011_clients_projects_redesign.sql`. Tests are pure-TypeScript assertions on Drizzle's runtime column metadata — they don't need a database.

**Tech Stack:** Drizzle ORM 0.36 · PostgreSQL via Neon · Vitest (node env) · drizzle-kit 0.28

**Branch:** `clients-projects-redesign` (already off `origin/v3-clean`).
**Design doc:** [`docs/plans/active/2026-05-14-clients-projects-redesign-design.md`](2026-05-14-clients-projects-redesign-design.md)
**Reviewer:** Raz (schema authorization is one-off per memory `feedback_schema_authorized_clients_projects.md`)

---

## Conventions

- **TDD throughout.** Write the test first, prove it fails, then write the smallest code to make it pass.
- **One column per commit.** Small commits are this repo's "context-survival memory" (memory `feedback_git_discipline.md`).
- **Test file:** `packages/db/src/__tests__/clients-projects-redesign.test.ts` (new file). Pure-runtime introspection of Drizzle column metadata. **No DB required.**
- **Drizzle schema file:** `packages/db/src/schema.ts` (modify in place).
- **Migration file:** `packages/db/drizzle/0011_clients_projects_redesign.sql` (new file, idempotent).
- **Commit prefix:** `feat(db): …` for column adds, `feat(db): SQL migration for …` for the migration file.

---

## Task 1 — Pre-flight

**Files:** (read-only)

**Step 1: Confirm branch + clean tree**

Run:
```bash
git rev-parse --abbrev-ref HEAD
git log --oneline -3
git status --short
```

Expected:
- Branch: `clients-projects-redesign`
- Last commit message starts with `docs(clients-projects): design brief for v3 redesign`
- `git status` should be clean (only untracked files unrelated to this work)

**Step 2: Read the design doc to refresh context**

Read: [`docs/plans/active/2026-05-14-clients-projects-redesign-design.md`](2026-05-14-clients-projects-redesign-design.md) — §4 (schema migrations) is the only section relevant here. Re-confirm the 6 columns and the 5 enum values.

**Step 3: Read the existing schema for context**

Read: `packages/db/src/schema.ts:313-321` — the existing `projectStage` enum pattern. Match the style.

**Step 4: Confirm migration number**

Run:
```bash
ls packages/db/drizzle/ | grep -E '^[0-9]+_' | sort | tail -3
```

Expected: highest current number is `0010_client_contacts_archived_at.sql`. Our migration is `0011_clients_projects_redesign.sql`.

(No commit in this task.)

---

## Task 2 — Add `workflow_stage` enum (Drizzle schema)

**Files:**
- Test: `packages/db/src/__tests__/clients-projects-redesign.test.ts` (create)
- Modify: `packages/db/src/schema.ts` (after line 320, alongside `projectStage`)

**Step 1: Write the failing test**

Create `packages/db/src/__tests__/clients-projects-redesign.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  workflowStage,
  clientContacts,
  projects,
  projectTracks,
  bookings,
} from "../index";

describe("Phase 0 — workflow_stage enum", () => {
  it("exports 5 stages in order: brief → production → mixing → mastering → done", () => {
    expect(workflowStage.enumValues).toEqual([
      "brief",
      "production",
      "mixing",
      "mastering",
      "done",
    ]);
  });
});
```

**Step 2: Verify test fails**

Run:
```bash
pnpm -F @skitza/db test -- clients-projects-redesign 2>&1 | tail -20
```

Expected: FAIL with "workflowStage is not exported" or similar TS error.

**Step 3: Implement (smallest change)**

In `packages/db/src/schema.ts`, after the `projectStage` declaration (around line 320), add:

```ts
// New workflow enum introduced by the Clients & Projects v3 redesign
// (design doc: docs/plans/active/2026-05-14-clients-projects-redesign-design.md).
// Drives the per-song stepper + the new Status stat tile on the Album hero.
// Lives alongside `projectStage` — the old enum keeps running billing.
export const workflowStage = pgEnum("workflow_stage", [
  "brief",
  "production",
  "mixing",
  "mastering",
  "done",
]);
```

Also ensure `workflowStage` is exported from `packages/db/src/index.ts` (it auto-exports via `export * from "./schema"` if that pattern is used — verify by reading the index file).

**Step 4: Run test to verify pass**

Run:
```bash
pnpm -F @skitza/db test -- clients-projects-redesign 2>&1 | tail -10
```

Expected: PASS (1 test, 0 failures).

**Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/__tests__/clients-projects-redesign.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add workflow_stage enum (brief→production→mixing→mastering→done)

Drizzle-schema half of the Phase 0 migration. SQL migration follows
in a later commit. Old projectStage enum is untouched.

Design: docs/plans/active/2026-05-14-clients-projects-redesign-design.md §4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Add `client_contacts.invited_at` column (Drizzle schema)

**Files:**
- Modify: `packages/db/src/schema.ts` (`clientContacts` definition, around line 505)
- Modify: `packages/db/src/__tests__/clients-projects-redesign.test.ts` (add test block)

**Step 1: Append the failing test**

In the same test file, append:

```ts
describe("Phase 0 — client_contacts.invited_at", () => {
  it("exists as a nullable timestamp column on client_contacts", () => {
    const col = clientContacts.invitedAt;
    expect(col).toBeDefined();
    expect(col.name).toBe("invited_at");
    expect(col.notNull).toBe(false);
  });
});
```

**Step 2: Verify fail**

Run:
```bash
pnpm -F @skitza/db test -- clients-projects-redesign 2>&1 | tail -10
```

Expected: FAIL with "Cannot read properties of undefined (reading 'name')" or similar.

**Step 3: Implement**

In `packages/db/src/schema.ts`, in the `clientContacts` table definition, alongside `archivedAt` (around line 505):

```ts
  // Linkpill "Invited" state for the Clients & Projects v3 redesign.
  // Stamped when the producer triggers Send Invite (email or copy-link)
  // from the Invite-to-App modal. Cleared when Clerk webhook resolves
  // `clerkUserId`. NULL means "no invite ever sent".
  invitedAt: timestamp("invited_at", { withTimezone: true }),
```

**Step 4: Verify pass**

Run:
```bash
pnpm -F @skitza/db test -- clients-projects-redesign 2>&1 | tail -10
```

Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/__tests__/clients-projects-redesign.test.ts
git commit -m "feat(db): add client_contacts.invited_at for linkpill Invited state"
```

---

## Task 4 — Add `client_contacts.position` column

**Files:**
- Modify: `packages/db/src/schema.ts` (`clientContacts`)
- Modify: `packages/db/src/__tests__/clients-projects-redesign.test.ts`

**Step 1: Failing test**

Append to test file:

```ts
describe("Phase 0 — client_contacts.position", () => {
  it("exists as an integer with default 0 for drag-reorder", () => {
    const col = clientContacts.position;
    expect(col).toBeDefined();
    expect(col.name).toBe("position");
    expect(col.notNull).toBe(true);
    expect(col.default).toBe(0);
  });
});
```

**Step 2: Verify fail**

```bash
pnpm -F @skitza/db test -- clients-projects-redesign 2>&1 | tail -10
```

Expected: FAIL.

**Step 3: Implement**

In `clientContacts`, alongside `invitedAt`:

```ts
  // Drag-to-reorder slot for the Clients list. NOT NULL with default 0
  // so existing rows back-fill safely. Reorder mutations update many
  // rows in a single transaction.
  position: integer("position").notNull().default(0),
```

**Step 4: Verify pass**

```bash
pnpm -F @skitza/db test -- clients-projects-redesign 2>&1 | tail -10
```

Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/__tests__/clients-projects-redesign.test.ts
git commit -m "feat(db): add client_contacts.position for drag-reorder"
```

---

## Task 5 — Add `projects.position` column

**Files:**
- Modify: `packages/db/src/schema.ts` (`projects`)
- Modify: `packages/db/src/__tests__/clients-projects-redesign.test.ts`

**Step 1: Failing test**

Append:

```ts
describe("Phase 0 — projects.position", () => {
  it("exists as an integer with default 0 for drag-reorder", () => {
    const col = projects.position;
    expect(col).toBeDefined();
    expect(col.name).toBe("position");
    expect(col.notNull).toBe(true);
    expect(col.default).toBe(0);
  });
});
```

**Step 2: Verify fail**, then **Step 3: Implement**

In `projects` (around line 406, before the closing `})`):

```ts
  // Drag-to-reorder slot for the Projects list. Same pattern as
  // client_contacts.position.
  position: integer("position").notNull().default(0),
```

**Step 4: Verify pass.** **Step 5: Commit:**

```bash
git add packages/db/src/schema.ts packages/db/src/__tests__/clients-projects-redesign.test.ts
git commit -m "feat(db): add projects.position for drag-reorder"
```

---

## Task 6 — Add `projects.workflow_stage` column

**Files:**
- Modify: `packages/db/src/schema.ts` (`projects`)
- Modify: `packages/db/src/__tests__/clients-projects-redesign.test.ts`

**Step 1: Failing test**

```ts
describe("Phase 0 — projects.workflow_stage", () => {
  it("exists as a non-null workflow_stage enum with default 'brief'", () => {
    const col = projects.workflowStage;
    expect(col).toBeDefined();
    expect(col.name).toBe("workflow_stage");
    expect(col.notNull).toBe(true);
    expect(col.default).toBe("brief");
  });
});
```

**Step 2: Verify fail.**

**Step 3: Implement**

In `projects`, alongside the new `position`:

```ts
  // Creative workflow stage for the new redesign hero + Status stat
  // tile. Decoupled from the legacy `stage` (lifecycle) column — both
  // co-exist; the new UI only ever shows this one.
  workflowStage: workflowStage("workflow_stage").notNull().default("brief"),
```

**Step 4: Verify pass.** **Step 5: Commit:**

```bash
git add packages/db/src/schema.ts packages/db/src/__tests__/clients-projects-redesign.test.ts
git commit -m "feat(db): add projects.workflow_stage (parallel to legacy stage)"
```

---

## Task 7 — Add `project_tracks.workflow_stage` column

**Files:**
- Modify: `packages/db/src/schema.ts` (`projectTracks` around line 420)
- Modify: `packages/db/src/__tests__/clients-projects-redesign.test.ts`

**Step 1: Failing test**

```ts
describe("Phase 0 — project_tracks.workflow_stage", () => {
  it("exists per-song with default 'brief' to drive the stepper", () => {
    const col = projectTracks.workflowStage;
    expect(col).toBeDefined();
    expect(col.name).toBe("workflow_stage");
    expect(col.notNull).toBe(true);
    expect(col.default).toBe("brief");
  });
});
```

**Step 2: Verify fail.**

**Step 3: Implement**

In `projectTracks`, before the closing `})`:

```ts
  // Per-song workflow stage. Drives the WorkflowStepper on Song Space
  // and the stage pill on Album tracklist rows. Advances when a new
  // version is uploaded with a higher stage; manual override available
  // from the Song Space.
  workflowStage: workflowStage("workflow_stage").notNull().default("brief"),
```

**Step 4: Verify pass.** **Step 5: Commit:**

```bash
git add packages/db/src/schema.ts packages/db/src/__tests__/clients-projects-redesign.test.ts
git commit -m "feat(db): add project_tracks.workflow_stage for per-song stepper"
```

---

## Task 8 — Add `bookings.song_id` FK column

**Files:**
- Modify: `packages/db/src/schema.ts` (`bookings` around line 259)
- Modify: `packages/db/src/__tests__/clients-projects-redesign.test.ts`

**Step 1: Failing test**

```ts
describe("Phase 0 — bookings.song_id", () => {
  it("exists as a nullable uuid FK to project_tracks", () => {
    const col = bookings.songId;
    expect(col).toBeDefined();
    expect(col.name).toBe("song_id");
    expect(col.notNull).toBe(false);
  });
});
```

**Step 2: Verify fail.**

**Step 3: Implement**

In `bookings`, before the closing `})` (around line 310):

```ts
  // Phase 0 of Clients & Projects v3 — links a booking to a specific
  // song so the Song Space's Sessions tab can scope to that song.
  // Nullable to preserve existing booking rows (they pre-date this
  // column and were never tied to a song). ON DELETE SET NULL so a
  // song delete doesn't cascade-delete sessions.
  songId: uuid("song_id").references(() => projectTracks.id, {
    onDelete: "set null",
  }),
```

Note: `projectTracks` is defined later in the file. Either move the column declaration after `projectTracks`, or use a lazy reference. Drizzle supports forward references in this pattern only when the referenced table is in the same module — verify by running typecheck after this change. If TS errors, move `projectTracks` definition above `bookings`, or extract the FK definition into a callback.

**Step 4: Verify pass**

Run typecheck + tests:
```bash
pnpm -F @skitza/db typecheck
pnpm -F @skitza/db test -- clients-projects-redesign 2>&1 | tail -10
```

Expected: both PASS (6 tests total).

**Step 5: Commit:**

```bash
git add packages/db/src/schema.ts packages/db/src/__tests__/clients-projects-redesign.test.ts
git commit -m "feat(db): add bookings.song_id FK for per-song Sessions tab"
```

---

## Task 9 — Write SQL migration `0011_clients_projects_redesign.sql`

**Files:**
- Create: `packages/db/drizzle/0011_clients_projects_redesign.sql`

**Step 1: Write the migration**

Create `packages/db/drizzle/0011_clients_projects_redesign.sql`:

```sql
-- Clients & Projects v3 redesign — Phase 0 migrations.
-- Design: docs/plans/active/2026-05-14-clients-projects-redesign-design.md
-- All additive. Old project.stage enum is preserved.

-- 1. New enum: workflow_stage (5 values)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_stage') THEN
    CREATE TYPE workflow_stage AS ENUM (
      'brief',
      'production',
      'mixing',
      'mastering',
      'done'
    );
  END IF;
END$$;

-- 2. client_contacts.invited_at — linkpill "Invited" state
ALTER TABLE client_contacts
  ADD COLUMN IF NOT EXISTS invited_at timestamptz;

-- 3. client_contacts.position — drag-reorder slot
ALTER TABLE client_contacts
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;

-- 4. projects.position — drag-reorder slot
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;

-- 5. projects.workflow_stage — new creative stage (parallel to legacy stage)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS workflow_stage workflow_stage NOT NULL DEFAULT 'brief';

-- 6. project_tracks.workflow_stage — per-song creative stage
ALTER TABLE project_tracks
  ADD COLUMN IF NOT EXISTS workflow_stage workflow_stage NOT NULL DEFAULT 'brief';

-- 7. bookings.song_id — link a session to a specific song
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS song_id uuid REFERENCES project_tracks(id) ON DELETE SET NULL;
```

**Step 2: Verify file syntax**

Run:
```bash
head -5 packages/db/drizzle/0011_clients_projects_redesign.sql
wc -l packages/db/drizzle/0011_clients_projects_redesign.sql
```

Expected: ~40 lines, comment header visible.

**Step 3: Commit (no apply yet)**

```bash
git add packages/db/drizzle/0011_clients_projects_redesign.sql
git commit -m "$(cat <<'EOF'
feat(db): SQL migration 0011 for Clients & Projects v3

Mirrors the Drizzle schema changes in 6 prior commits:
- New enum workflow_stage (5 values)
- client_contacts.invited_at, .position
- projects.position, .workflow_stage
- project_tracks.workflow_stage
- bookings.song_id (FK with ON DELETE SET NULL)

Idempotent. ADD COLUMN IF NOT EXISTS + DO-block guard around CREATE TYPE.

Design: docs/plans/active/2026-05-14-clients-projects-redesign-design.md §4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 — Apply migration to local dev DB

**Files:** (read-only — operates on real database)

**Step 1: Check DATABASE_URL is set**

Run:
```bash
test -n "$DATABASE_URL" && echo "ok" || (test -f apps/web/.env.local && echo "found .env.local, source it" || echo "MISSING")
```

If missing, ask Gili for the dev DATABASE_URL or source from `apps/web/.env.local`.

**Step 2: Apply migration via `/skitza-migrate` skill**

The repo's apply-migrations.mjs is idempotent (see file header in `packages/db/apply-migrations.mjs`). Run:

```bash
cd packages/db
DATABASE_URL="$DATABASE_URL" node apply-migrations.mjs 2>&1 | tail -20
```

Expected: log lines including `0011_clients_projects_redesign.sql ... ok` and no error lines.

**Step 3: Verify columns exist via psql or a quick query**

If `psql` available:
```bash
psql "$DATABASE_URL" -c "\d+ client_contacts" 2>&1 | grep -E "invited_at|position"
psql "$DATABASE_URL" -c "\d+ projects" 2>&1 | grep -E "position|workflow_stage"
psql "$DATABASE_URL" -c "\d+ project_tracks" 2>&1 | grep "workflow_stage"
psql "$DATABASE_URL" -c "\d+ bookings" 2>&1 | grep "song_id"
psql "$DATABASE_URL" -c "SELECT typname FROM pg_type WHERE typname = 'workflow_stage';"
```

Expected: each grep matches; `workflow_stage` listed.

If `psql` not available, write a one-off Node script using `@neondatabase/serverless` and `sql\`SELECT column_name FROM information_schema.columns WHERE table_name = '…'\`` — but this is overkill for the verification step. Prefer asking Gili to confirm via Neon console if `psql` isn't installed.

(No commit in this task — the schema is now applied to the DB but no source file changes.)

---

## Task 11 — Pipeline gate: `/skitza-verify`

**Step 1: Run the full pipeline**

```bash
pnpm typecheck && pnpm -F web lint && pnpm test 2>&1 | tail -20
```

Expected: all 3 green. Vercel runs ESLint with `--max-warnings 0` (memory `feedback_run_lint_not_just_typecheck.md`).

**Step 2: If any failure, fix and re-run**

Common failures expected at this point:
- TS error if `bookings.songId` forward-reference to `projectTracks` didn't resolve — move `projectTracks` definition above `bookings` in `schema.ts` (small reorder; no behavioural change).
- Vitest finding no test files — the new `__tests__/clients-projects-redesign.test.ts` should be auto-discovered; check `packages/db/vitest.config.*` if not.

After any fix, re-run Step 1 until green.

**Step 3: Final commit if any fixes were needed**

If you had to reorder the schema file or fix anything, commit it:
```bash
git add -p packages/db/src/schema.ts
git commit -m "fix(db): resolve forward-reference in schema for bookings.song_id"
```

---

## Task 12 — Push branch + open PR

**Step 1: Push branch**

```bash
git push -u origin clients-projects-redesign 2>&1 | tail -5
```

Expected: branch created on origin.

**Step 2: Open PR**

Run:
```bash
gh pr create --base v3-clean --title "feat(db): clients-projects redesign — Phase 0 (schema)" --body "$(cat <<'EOF'
## Summary

Phase 0 of the Clients & Projects v3 redesign. **Schema-only — no UI changes.**

Adds:
- New enum `workflow_stage` (brief / production / mixing / mastering / done)
- `client_contacts.invited_at` — for the linkpill "Invited" state
- `client_contacts.position` — drag-to-reorder slot
- `projects.position` — drag-to-reorder slot
- `projects.workflow_stage` — new creative stage (parallel to legacy `stage`)
- `project_tracks.workflow_stage` — per-song stage for the stepper
- `bookings.song_id` — per-song Sessions tab (FK to project_tracks, ON DELETE SET NULL)

All changes additive. Old `project.stage` is untouched — billing keeps running.

## Why this exists

Design brief: `docs/plans/active/2026-05-14-clients-projects-redesign-design.md`

The five subsequent phases (list/client polish, album page, song space, upload modal, optional player polish) each need one or more of these columns. They ship as separate PRs against `v3-clean`.

## Schema authorization

Per memory note `feedback_schema_authorized_clients_projects.md`, Gili authorized me to write the migrations directly for this redesign, with Raz reviewing the PR before merge. CLAUDE.md's default ("Raz owns schema") still holds for anything outside this redesign.

## Test plan

- [x] `pnpm -F @skitza/db test -- clients-projects-redesign` → 6 tests green (pure Drizzle-runtime assertions, no DB needed)
- [x] `pnpm typecheck && pnpm -F web lint && pnpm test` → all green
- [x] Migration applied to dev DB via `apply-migrations.mjs`; all 6 columns + enum confirmed via `\d+`
- [ ] **Raz reviews** schema before merge

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 3: Share PR URL with Gili**

The `gh pr create` output prints the URL. Report it back so Gili can ping Raz.

(No commit in this task.)

---

## Done criteria

- [ ] All 12 tasks completed
- [ ] 7 commits on branch (or 6 + 1 fix-commit) — one per migration step, one for the SQL file
- [ ] PR opened against `v3-clean` and awaiting Raz's review
- [ ] Local dev DB has all 6 new columns + the new enum
- [ ] `/skitza-verify` is green
- [ ] No file outside `packages/db/` has been touched in this PR

## Open follow-ups (not in Phase 0)

- Vercel preview DB will be migrated automatically by the deploy hook (verify in deploy log on first push).
- Production DB migration happens on PR merge — verify with `/skitza-migrate` or Neon console.
- Phase 1 plan written after Phase 0 ships.

---

## Notes for execution

- **Forward references** in Drizzle schema: if `bookings.song_id` references `projectTracks` before the latter is declared in the file, TypeScript will error. Fix: move `projectTracks` (and its dependents `trackVersions`, `trackComments`) above `bookings` in `schema.ts`. This is a pure reorder — no logic change.
- **Drizzle runtime metadata**: each column object exposes `.name`, `.notNull`, `.default`, `.dataType`. We use these to assert structure without spinning up a DB.
- **`apply-migrations.mjs` behavior**: idempotent via `IF NOT EXISTS` and `DO $$ … $$` blocks. Safe to re-run on dev DB; safe on prod when PR merges.
