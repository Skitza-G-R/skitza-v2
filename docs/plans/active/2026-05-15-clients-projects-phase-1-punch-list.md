# Clients & Projects Phase 1 — Punch List

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the 5 spec-vs-implementation gaps found in PR #117 and get Phase 1 ready to merge into `v3-clean`.

**Architecture:** TDD-first, source-grep tests on JSX shells (repo convention — no jsdom). Each fix is one logical commit on the existing `clients-projects-phase-1` branch. PR #117 stays open and gathers these commits.

**Tech Stack:** Next.js 15 App Router · React 19 · Tailwind v4 · Radix UI · Vitest (node env, no jsdom)

**Branch:** `clients-projects-phase-1` (worktree at `/Users/giliasraf/skitza-phase-1`)
**PR:** [#117](https://github.com/Skitza-G-R/skitza-v2/pull/117) — open, CI green
**Audit source:** Phase 1 audit run on 2026-05-15 (this session)

---

## Gaps being closed

| Tag | Description | Severity |
|---|---|---|
| **G1** | Missing page header CTA "+ New project" / "+ New client" | Blocker — primary action missing |
| **G2** | Tab default + order conflicts with design spec | Spec deviation |
| **G3** | Project filter chip label says "Urgent", spec + sibling KPI say "Needs attention" | Visible inconsistency |
| **G4** | Layout switcher is a no-op on Projects tab | UX dead-end |
| **G5** | ProjectRow's status pill is rendered as the chevron column (color-only, no label) | Visible bug |

Already done in pre-flight (commit `b55caf2`): demo seed script deleted.

---

## Decisions baked into this plan

These resolve the two spec-vs-plan conflicts. **If you disagree with either, say so before execution starts and I'll adjust the plan.**

| # | Decision | Rationale |
|---|---|---|
| **G2** | **Clients tab is first and the default selected tab.** | Matches `DESIGN.md §4.1` ("Two top-level tabs: **Clients** (default) and **Projects**") and `BUILD-NOTES.md §10` verification list. The Phase 1 plan's "Projects per existing routing" was a residual habit from the OLD design that's being replaced. New IA = clients OWN projects. |
| **G4** | **Hide the layout switcher when `tab === "projects"`.** | Real table mode (sortable column headers per BUILD-NOTES §5.1) is multi-day work. `ProjectRow` is already row-shaped, so "cards" and "table" mode look identical on Projects. Cleaner to hide the no-op control than to ship a fake one. The full table view is captured in "Open follow-ups" below. |

---

## Conventions (carried over from the original Phase 1 plan)

- **TDD throughout.** Write the test first, prove it fails, then write the smallest code to make it pass.
- **One commit per task.** Small commits are the repo's context-survival memory (memory `feedback_git_discipline.md`).
- **Test pattern for `.tsx` shells:** source-grep with `readFileSync`, assert imports / classNames / structure. No jsdom.
- **`git add` is always explicit** — no `git add .` or `-A`.
- **CSS tokens** (memory `feedback_skitza_css_tokens.md`): only use `--bg-elevated`, `--fg-muted`, `--fg-default`, `--bg-sidebar`, `--border-subtle`, etc. NEVER use `--surface-card`, `--text-muted`, `--text-strong`, `--surface-hover`, `--brand-primary-on`.
- **All commits get the trailer:** `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- **Pre-push gate is mandatory:** `pnpm typecheck && pnpm -F web lint && pnpm test` must pass. Use `/skitza-verify`.
- **Worktree:** all work happens at `/Users/giliasraf/skitza-phase-1`, NOT the main worktree.

---

## Task 1 — Pre-flight

**Goal:** Confirm we're on the right branch and the baseline is green before changing anything.

**Step 1: Confirm branch + tree.**
```bash
cd /Users/giliasraf/skitza-phase-1
git rev-parse --abbrev-ref HEAD     # expect: clients-projects-phase-1
git log --oneline -3                # expect: b55caf2 chore(scripts): drop seed... (top)
git status --short                  # expect: clean
```

**Step 2: Baseline `/skitza-verify`.**
```bash
pnpm typecheck && pnpm -F web lint && pnpm test 2>&1 | tail -15
```
Expected: all three green. **If anything is red, STOP and surface the breakage before continuing.** The remaining tasks assume a green baseline.

(No commit in this task.)

---

## Task 2 — G3: Rename project filter chip from "Urgent" to "Needs attention"

**Goal:** Match the design spec and the KPI tile of the same name sitting right next to it.

**Files:**
- Modify: `apps/web/src/components/dashboard/clients-projects/workspace-list-view.tsx` (lines 35-40 — the `PROJECT_FILTERS` array)
- Modify: `apps/web/src/components/dashboard/clients-projects/__tests__/workspace-list-view.test.tsx`

**Step 1: Add failing test.** Append to the existing test file:
```ts
it("labels the danger-tone project filter 'Needs attention' (matches DESIGN.md §4.1 + KPI tile)", () => {
  expect(SRC).toMatch(/value:\s*["']urgent["'],\s*label:\s*["']Needs attention["']/);
  expect(SRC).not.toMatch(/label:\s*["']Urgent["']/);
});
```

**Step 2: Verify fail.**
```bash
pnpm -F web test -- workspace-list-view 2>&1 | tail -10
```
Expected: FAIL on the new assertion.

**Step 3: Update the `PROJECT_FILTERS` array** in `workspace-list-view.tsx:35-40`:
```ts
const PROJECT_FILTERS = [
  { value: "all", label: "All" },
  { value: "urgent", label: "Needs attention" },  // value stays "urgent" — filtering logic untouched
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
] as const;
```

**Step 4: Verify pass.**
```bash
pnpm -F web test -- workspace-list-view 2>&1 | tail -10
```
Expected: PASS.

**Step 5: Commit.**
```bash
git add apps/web/src/components/dashboard/clients-projects/workspace-list-view.tsx \
        apps/web/src/components/dashboard/clients-projects/__tests__/workspace-list-view.test.tsx
git commit -m "$(cat <<'EOF'
fix(clients-projects): rename project filter "Urgent" → "Needs attention" (G3)

Matches DESIGN.md §4.1 + BUILD-NOTES.md §10 and aligns with the
sibling KPI tile of the same name in the same view. Filter value
stays 'urgent' so the existing danger-tone filtering logic is
untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — G2: Switch default tab to Clients + reorder JSX

**Goal:** Clients tab is the **first** button visible AND the **default** selected tab. Per DESIGN.md §4.1 + BUILD-NOTES.md §10 verification list.

**Files:**
- Modify: `apps/web/src/components/dashboard/clients-projects/workspace-list-view.tsx` — line 118 (the `useState<Tab>` initializer) + lines 333-372 (swap the two tab buttons)
- Modify: `apps/web/src/components/dashboard/clients-projects/__tests__/workspace-list-view.test.tsx`

**Step 1: Add failing tests.**
```ts
it("defaults to the Clients tab", () => {
  expect(SRC).toMatch(/useState<Tab>\(["']clients["']\)/);
});

it("renders the Clients tab button before the Projects tab button", () => {
  const clientsIdx = SRC.indexOf(">Clients<");
  const projectsIdx = SRC.indexOf(">Projects<");
  expect(clientsIdx).toBeGreaterThan(-1);
  expect(projectsIdx).toBeGreaterThan(clientsIdx);
});
```

**Step 2: Verify fail.**

**Step 3: Update `workspace-list-view.tsx`:**
- Line 118: change `useState<Tab>("projects")` to `useState<Tab>("clients")`.
- Lines 333-372: swap the two `<button>` blocks so the Clients button is rendered first. Keep all styling/aria attributes identical — only the JSX order changes.

**Step 4: Verify pass.**

**Step 5: Commit.**
```bash
git add apps/web/src/components/dashboard/clients-projects/workspace-list-view.tsx \
        apps/web/src/components/dashboard/clients-projects/__tests__/workspace-list-view.test.tsx
git commit -m "$(cat <<'EOF'
fix(clients-projects): Clients tab is first + default (G2)

Matches DESIGN.md §4.1 + BUILD-NOTES.md §10 verification checklist.
The new IA has clients OWN projects — the natural landing is the
people, not the work. Previous Phase 1 plan defaulted to Projects
as a residual habit from the OLD design.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — G4: Hide layout switcher on Projects tab

**Goal:** Don't render the cards/table toggle when it's a no-op. The Projects tab always renders `ProjectRow` (row-shaped); real table mode (sortable column headers) is deferred to a fast-follow PR.

**Files:**
- Modify: `apps/web/src/components/dashboard/clients-projects/workspace-list-view.tsx` (~lines 428-476 — the `<div role="group" aria-label="Layout">…</div>` block)
- Modify: `apps/web/src/components/dashboard/clients-projects/__tests__/workspace-list-view.test.tsx`

**Step 1: Add failing test.**
```ts
it("only renders the layout switcher when tab is 'clients'", () => {
  // The aria-label="Layout" wrapper must sit inside a `tab === "clients"` conditional
  expect(SRC).toMatch(/\{tab\s*===\s*["']clients["'][\s\S]{0,600}aria-label=["']Layout["']/);
});
```

**Step 2: Verify fail.**

**Step 3: Wrap the existing layout-switcher `<div>` in `{tab === "clients" ? (…) : null}`.** The wrapper goes around the entire `role="group" aria-label="Layout"` block. Nothing else changes — no styling, no behavior shift on the Clients tab.

**Step 4: Verify pass.**

**Step 5: Commit.**
```bash
git add apps/web/src/components/dashboard/clients-projects/workspace-list-view.tsx \
        apps/web/src/components/dashboard/clients-projects/__tests__/workspace-list-view.test.tsx
git commit -m "$(cat <<'EOF'
fix(clients-projects): hide cards/table switcher on Projects tab (G4)

The Projects tab only renders ProjectRow (row-shaped), so the
toggle was a no-op. Real table mode with sortable column headers
is deferred to a fast-follow PR. Clients tab keeps the toggle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — G5: Split status pill from chevron in ProjectRow

**Goal:** Status appears as a **labeled** pill in the title block (e.g. "BOOKED", "REVIEW", "DONE"). The 8th grid column is a **plain chevron** with no pill styling. Per `DESIGN.md §5.1`.

**Why this is a real bug:** the current 8th column wraps a `ChevronRight` in a colored pill that uses `statusTone` for color. The `status` text is buried in `aria-label`, so sighted users see color-only, no label. And the title-block pill only renders when the optional `tag` field is set — which neither page.tsx sets.

**Files:**
- Modify: `apps/web/src/components/dashboard/projects/project-row.tsx`
- Modify: `apps/web/src/components/dashboard/projects/__tests__/project-row.test.tsx`

**Discovery step:** the `tag` field on `ProjectRowData` becomes obsolete after this fix (the title-block pill now reads from `status`). Decision: **drop `tag` entirely.** Neither page.tsx sets it. If we ever need a secondary chip, add it back as a different prop.

**Step 1: Add failing tests.**
```ts
it("renders the status label as a visible pill in the title block (not just aria-label)", () => {
  // The pill rendering must reference `status`, not `tag`
  expect(SRC).toMatch(/>\{status\}</);
});

it("uses a plain ChevronRight in the 8th column with no pill styling", () => {
  // Grab everything after the last ChevronRight occurrence — should not contain pill classes or tone style
  const lastChevronIdx = SRC.lastIndexOf("ChevronRight");
  expect(lastChevronIdx).toBeGreaterThan(-1);
  const tail = SRC.slice(lastChevronIdx);
  expect(tail).not.toMatch(/pill-(danger|warn|ok|neutral)/);
  expect(tail).not.toMatch(/style=\{tone\}/);
});

it("no longer accepts a 'tag' field on ProjectRowData", () => {
  // ProjectRowData interface should not include `tag`
  expect(SRC).not.toMatch(/\btag\?:/);
});
```

**Step 2: Verify fail.**

**Step 3: Refactor `project-row.tsx`:**

a) Drop `tag` from `ProjectRowData`:
```ts
export interface ProjectRowData {
  id: string;
  title: string;
  client: string;
  /** Optional second-line meta — e.g. client email. */
  meta?: string;
  progress: number;
  balance: number;
  deadline: string;
  status: string;          // visible pill label (e.g. "Booked", "Review", "Done")
  statusTone: ProjectRowStatusTone;
  currency?: string;
  updatedAtIso?: string;
  deadlineAtIso?: string | null;
}
```

b) Drop the `tag` destructure on line ~117 (keep everything else).

c) In the title block (around line 171), replace the conditional `tag` pill with an always-on `status` pill:
```tsx
<Link href={...}>{title}</Link>
<span
  className={`mt-0.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${toneCls}`}
  style={tone}
>
  {status}
</span>
{meta ? <p ...>{meta}</p> : null}
```

d) In the 8th column (around line 239), replace the colored-pill chevron with a plain one:
```tsx
<ChevronRight
  size={14}
  style={{ color: "rgb(var(--fg-muted))" }}
  aria-label={`Status: ${status}`}
/>
```

(Keep `aria-label` on the chevron so screen readers still announce the status, since the visible pill is on the left.)

**Step 4: Verify pass.**

**Step 5: TypeScript safety check.** Drop the `tag` field is a breaking interface change — typecheck must catch any stale callers.
```bash
pnpm typecheck 2>&1 | tail -10
```
Expected: clean. (Neither page.tsx sets `tag`, so there should be no breakage.)

**Step 6: Commit.**
```bash
git add apps/web/src/components/dashboard/projects/project-row.tsx \
        apps/web/src/components/dashboard/projects/__tests__/project-row.test.tsx
git commit -m "$(cat <<'EOF'
fix(projects): show status label as pill, drop pill styling from chevron (G5)

ProjectRow's 8th column was rendering a colored pill containing
a chevron — duplicating the status tone and burying the status text
in aria-label only. Now: the labeled status pill lives in the title
block (per DESIGN.md §5.1) and the 8th column is a plain chevron.
The obsolete optional `tag` field is dropped from ProjectRowData.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — G1: Add page header with tab-aware "+ New project" / "+ New client" CTA

**Goal:** Render a header above the KPI strip with `Clients & Projects` title on the left and a primary CTA on the right that switches between **"New project"** (when Projects tab is active) and **"New client"** (when Clients tab is active). Per `DESIGN.md §4.1` + `BUILD-NOTES.md §5.1`.

**Files:**
- Modify: `apps/web/src/components/dashboard/clients-projects/workspace-list-view.tsx`
- Modify: `apps/web/src/components/dashboard/clients-projects/__tests__/workspace-list-view.test.tsx`

### Step 0 — Discovery (no code yet)

The "+ New project" target route exists: `/dashboard/clients-projects/new` (confirmed — `new-project-form.tsx` + `page.tsx`).

The "+ New client" flow does **not** exist as a modal in the current codebase (grepped — no `NewClientModal`, no `new-client-modal.tsx`, no dedicated `/clients/new` route).

**Recommended v1 wiring:** route the "+ New client" CTA to the existing `/dashboard/clients-projects/new` page with a query param hinting that the client picker should auto-focus a "+ New client" sub-flow. Two options:

- **6A:** route to `/dashboard/clients-projects/new?clientFirst=1`. The new-project form already accepts query params (it accepts `clientEmail` + `clientName` per `client-space-hero.tsx:84-87`). Adding a `clientFirst` branch to the form is small.
- **6B:** build a dedicated New Client modal mounted in `WorkspaceListView` (similar pattern to `InviteToAppModal`). Bigger scope.

**This plan ships 6A** (smaller, ships in one task). If you want 6B, say so before execution and I'll expand this task.

### Step 1: Add failing tests
```ts
it("renders a header above the KPI strip with the 'Clients & Projects' title", () => {
  expect(SRC).toContain("Clients & Projects");
});

it("renders a tab-aware CTA — 'New client' on the Clients tab", () => {
  expect(SRC).toMatch(/tab\s*===\s*["']clients["'][\s\S]{0,400}New client/);
});

it("renders a tab-aware CTA — 'New project' on the Projects tab", () => {
  expect(SRC).toMatch(/tab\s*===\s*["']projects["'][\s\S]{0,400}New project/);
});

it("links the 'New project' CTA to the existing new-project route", () => {
  expect(SRC).toMatch(/href=["']\/dashboard\/clients-projects\/new["']/);
});
```

### Step 2: Verify fail

### Step 3: Implement

a) Add imports at the top of `workspace-list-view.tsx`:
```ts
import Link from "next/link";
import { Plus } from "lucide-react";
```

b) At the top of the returned JSX (before the KPI strip on line 302), add the header block:
```tsx
<header className="flex items-center justify-between gap-3">
  <h1
    className="font-syne text-[24px] font-bold tracking-tight"
    style={{ color: "rgb(var(--fg-default))" }}
  >
    Clients & Projects
  </h1>
  {tab === "clients" ? (
    <Link
      href="/dashboard/clients-projects/new?clientFirst=1"
      className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold shadow-[0_2px_8px_-2px_rgb(var(--brand-primary)/0.5)] transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2"
      style={{
        background: "rgb(var(--brand-primary))",
        color: "rgb(var(--bg-sidebar))",
      }}
    >
      <Plus size={14} strokeWidth={2.4} />
      New client
    </Link>
  ) : (
    <Link
      href="/dashboard/clients-projects/new"
      className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold shadow-[0_2px_8px_-2px_rgb(var(--brand-primary)/0.5)] transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2"
      style={{
        background: "rgb(var(--brand-primary))",
        color: "rgb(var(--bg-sidebar))",
      }}
    >
      <Plus size={14} strokeWidth={2.4} />
      New project
    </Link>
  )}
</header>
```

### Step 4: Verify pass

### Step 5: (Optional, non-blocking) — wire `clientFirst=1` in the new-project form

If the new-project form ignores `clientFirst`, the "+ New client" CTA lands on the new-project page with the client picker simply at the top. That's acceptable for v1. **A real "+ New client" modal can be a Phase 1.5 fast-follow.**

If you want the `clientFirst` branch to do something specific now (e.g. focus the client field, hide the project fields until a client is chosen), say so and add it as Task 6b. Otherwise skip.

### Step 6: Commit
```bash
git add apps/web/src/components/dashboard/clients-projects/workspace-list-view.tsx \
        apps/web/src/components/dashboard/clients-projects/__tests__/workspace-list-view.test.tsx
git commit -m "$(cat <<'EOF'
feat(clients-projects): page header with tab-aware New CTA (G1)

Adds the primary CTA that was missing from the list view per
DESIGN.md §4.1 + BUILD-NOTES.md §5.1. Header text + handler
switch based on the active tab:
- Clients tab → "New client" → /clients-projects/new?clientFirst=1
- Projects tab → "New project" → /clients-projects/new

A dedicated New Client modal is captured as a fast-follow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Refresh `docs/session_recap.md`

**Goal:** Reflect that Phase 1 is in PR #117 with the G1-G5 punch list applied. Current recap is dated 2026-05-14 and still says "Phase 0 awaiting Raz" — stale.

**File:** `docs/session_recap.md`

Rewrite the top sections so a future Claude session reading it understands:
1. Phase 0 merged (PR #113).
2. Phase 1 is on `clients-projects-phase-1`, PR #117.
3. Tasks 2-18 of the original Phase 1 plan are done, plus the G1-G5 punch list from this plan.
4. Status: awaiting manual Incognito QA in Vercel preview, then merge.
5. Next phase = Phase 2 (Album page) on a fresh branch off `v3-clean`.

**Keep** the bottom sections that are still load-bearing: "Token reality check" + "Testing convention" + "Auxiliary stashes".

**Commit:**
```bash
git add docs/session_recap.md
git commit -m "docs(recap): update session recap for Phase 1 (PR #117) status

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 — `/skitza-verify` (mandatory gate)

```bash
cd /Users/giliasraf/skitza-phase-1
pnpm typecheck && pnpm -F web lint && pnpm test 2>&1 | tail -30
```

**All three must be green.** Common failure modes for this punch list:

| Failure | Likely cause | Fix |
|---|---|---|
| Test asserts `"Urgent"` somewhere | Forgot to update sibling assertion | Grep tests for `Urgent` and update |
| Lint trips on unused `Plus` / `Link` import | Imported but the JSX block was placed outside their scope | Move the import next to the block that uses it |
| Typecheck trips on `tag` reference | A test or page still passes `tag` to `ProjectRowData` | Remove the obsolete prop |
| `expect(SRC)…toMatch(/.../)` fails | Source whitespace doesn't match the regex | Loosen the regex with `\s*` |

If green: proceed to Task 9. If red: fix the smallest thing and re-run.

(No commit in this task.)

---

## Task 9 — Push + update PR body + Vercel preview redeploy

**Step 1: Push.**
```bash
git push origin clients-projects-phase-1 2>&1 | tail -5
```

**Step 2: Update PR #117 body.** Append a "Phase 1 punch list (2026-05-15)" section under the existing summary that lists the G1-G5 fixes:

```bash
gh pr view 117 --json body --jq '.body' > /tmp/pr117-body.md
# Then edit /tmp/pr117-body.md to append the punch list section, then:
gh pr edit 117 --body-file /tmp/pr117-body.md
```

The appended section (rough copy):
```markdown
## Phase 1 punch list — applied 2026-05-15

Closes the gaps surfaced in the 2026-05-15 audit. Plan: `docs/plans/active/2026-05-15-clients-projects-phase-1-punch-list.md`

- **G1**: Page header with tab-aware "New client" / "New project" CTA
- **G2**: Clients tab is now first and the default (matches DESIGN.md §4.1 + BUILD-NOTES §10)
- **G3**: Project filter "Urgent" → "Needs attention" (matches sibling KPI tile)
- **G4**: Cards/table layout switcher now hidden on Projects tab (was no-op)
- **G5**: Status pill rendered as a labeled chip in the title block; chevron column is plain
- Deleted the `seed-clients-projects-demo.mjs` script (preview will use real producer data)

Fast-follows captured: real Projects table mode, dedicated New Client modal, URL hydration for tab/sort/filter.
```

**Step 3: Confirm Vercel preview redeploys.** GitHub bot will post the new "Ready" link in the PR comments within ~2 min. Read the bot's comment to get the URL; don't probe HTML (memory: SSO 401 on anon curl).

**Step 4: Report back to Gili:** "Phase 1 punch list applied. PR #117 pushed. Preview redeployed at `<url>`. Ready for Incognito QA against the 12-item checklist in the PR body."

---

## Done criteria

- [ ] Task 1 baseline green
- [ ] G1: page header + tab-aware CTA visible in preview
- [ ] G2: Clients tab first + default in preview
- [ ] G3: filter chip reads "Needs attention" in preview
- [ ] G4: layout switcher only visible on Clients tab
- [ ] G5: status pill labeled, chevron plain
- [ ] `session_recap.md` refreshed
- [ ] Task 8 `/skitza-verify` green
- [ ] PR #117 pushed + body updated
- [ ] Vercel preview redeployed + URL reported

Once everything is checked: ready for Gili's manual Incognito QA against the 12-item PR-body checklist. On QA pass → merge → Phase 2 (Album page) starts.

---

## Open follow-ups (NOT in this plan — defer to fast-follows or Phase 2+)

| Item | Why deferred |
|---|---|
| Real "table mode" for Projects (sortable column headers per BUILD-NOTES §5.1) | Multi-day work. Current `ProjectRow` already row-shaped — same info, no sortable header. |
| Dedicated "New Client" modal | This plan wires the CTA to the existing `/new` route with `?clientFirst=1`. A real modal is a Phase 1.5 fast-follow if Gili wants it. |
| URL hydration (`?tab=`, `?sort=`, `?filter=`) | Bookmarking is nice-to-have. `WorkspaceListView` owns state locally for now. |
| Drag accessibility (keyboard arrow nav) | Per original Phase 1 plan §9 — accepted defer. |
| PersistentPlayer visual polish to match prototype's `#player` spec | Captured as Phase 5 fast-follow per design doc. |
