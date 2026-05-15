# Clients & Projects Redesign — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Big-bang visual rebuild of `/dashboard/clients-projects` (list view) and `/dashboard/clients-projects/clients/[id]` (Client Space). Drop the existing 4-tab Client Space entirely. Replace ProjectsList + ClientsListScreen with the prototype's design. Ship LinkPill, Invite-to-App modal (email + copy-link), drag-to-reorder mutations, and the new server-side data shape needed for these surfaces. **One PR, many commits.**

**Architecture:** Bottom-up — build pure helpers first (gradient deriver, hero-bg map), then atom components (LinkPill, StatTile, HeroCTA), then row components (ProjectRow, ClientCard), then composed surfaces (ClientSpace, ListView), then tRPC mutations, then swap page.tsx imports, then delete the obsoleted files. Typecheck stays green across the whole sequence — old files are only removed once their callers point to new files.

**Tech Stack:** Next.js 15 App Router · tRPC v11 · Drizzle · Tailwind v4 + shadcn/ui · Vitest (node env, no jsdom) · Resend (for invite email) · React-DnD-free drag (HTML5 native `draggable` + custom-event reorder)

**Branch:** `clients-projects-phase-1` (already off `origin/v3-clean` which now contains Phase 0's schema)
**Design doc:** [`docs/plans/active/2026-05-14-clients-projects-redesign-design.md`](2026-05-14-clients-projects-redesign-design.md)
**Phase 0 PR (merged):** [#113](https://github.com/Skitza-G-R/skitza-v2/pull/113) — schema migrations live in `v3-clean`

---

## Decisions baked into this plan (do not re-litigate)

| Decision | Source |
|---|---|
| Big bang — drop the old 4-tab Client Space; new Client Space is single-page | Gili 2026-05-14 |
| One Phase 1 PR (not split into 1a/1b/1c) | Gili 2026-05-14 |
| TDD throughout — test before implementation for every component + procedure | Gili 2026-05-14 |
| Drop these surfaces entirely (no UI exposure, columns/tables stay in DB): Client Overview tab, Client Payments tab, Client Notes tab (`clientContacts.notes`, `tags`, `referralSource` become invisible until a future phase exposes them) | Gili 2026-05-14 |
| Reuse `producerGradient` + `producerInitials` from `~/lib/_phase4-stubs/producer-color` for AVATAR gradient — don't fork | Established convention |
| Build a NEW `hero-bg.ts` for the dark hero gradients (the prototype's `heroBg(grad)` map) — these are distinct from avatar gradients | Prototype spec |
| Visual rebuild of `/clients-projects` list view = new ListView replaces ProjectsList + ClientsListScreen entirely. Tabs (Projects / Clients) stay. KPI strip + filter chips + sort dropdown + drag stay per spec. | Gili 2026-05-14 (big bang) |
| Drag-to-reorder uses native HTML5 `draggable="true"` + custom events — no React-DnD library | Repo precedent (`booking-packages-reorder`) |
| Resend already used in the repo for emails | `apps/web/src/server/email/` |
| Sort dropdown order: `custom` (default) / `recent` / `deadline` / `balance` / `progress` / `name` | Prototype spec |
| Filter chips: `all` / `urgent` / `active` / `done` (project list); `all` / `active` / `balance` (clients list) | Prototype spec |

---

## Conventions

- **TDD throughout.** Write the test first, prove it fails, then write the smallest code to make it pass.
- **One commit per task.** Small commits are this repo's "context-survival memory" (memory `feedback_git_discipline.md`).
- **Test pattern for `.tsx` shells:** source-grep with `readFileSync`, assert imports / classNames / structure. No jsdom (memory `session_recap.md` testing convention).
- **Test pattern for pure helpers:** standard `expect(fn(input)).toBe(output)`.
- **Test pattern for tRPC procedures:** match existing `apps/web/src/server/trpc/routers/__tests__/booking-packages-reorder.test.ts` style — set up a producer in a real test DB, invoke procedure via caller, assert DB state.
- **`git add` is always explicit** — no `git add .` or `-A`. Other branches may have working-tree state we don't want to scoop up (memory: worktree branch can flip silently).
- **Commit message convention:** `feat(clients): …` for UI work, `feat(trpc): …` for procedures, `chore(clients): delete X` for old-file removals.
- **All commits get the trailer:** `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- **CSS tokens** (memory `feedback_skitza_css_tokens.md`): use `--bg-elevated`, `--fg-muted`, `--fg-default`, `--bg-sidebar`, `--border-subtle`, etc. NEVER use `--surface-card`, `--text-muted`, `--text-strong`, `--surface-hover`, `--brand-primary-on` (they don't exist).

---

## Pre-flight (Task 1)

**Step 1:** Confirm branch + clean tree.
```bash
cd "/Users/giliasraf/Skitza 16.4"
git rev-parse --abbrev-ref HEAD     # expect: clients-projects-phase-1
git log --oneline -3                # expect: top commit = ca9e008 (Phase 0)
git status --short                  # expect: only untracked screenshots / .agents / .claude
```

**Step 2:** Read design doc §3 (divergences) + §5 (component plan) for context.

**Step 3:** Confirm Phase 0 columns are queryable. Quick sanity:
```bash
grep -n "workflow_stage\|invited_at\|songId\|client_contacts.*position\|projects.*position" packages/db/src/schema.ts | head -10
```
Expected: matches for `workflowStage` enum + `invitedAt` + `bookings.songId` + the two `position` columns.

(No commit in this task.)

---

## Part A — Pure helpers (Tasks 2-3)

### Task 2 — `derive-gradient.ts`

**Goal:** A pure deterministic helper that maps a name to one of 6 gradient tokens (`grad-rose`, `grad-amber`, `grad-slate`, `grad-emerald`, `grad-violet`, `grad-indigo`). Same FNV-31 hash style as `producerHue`.

**Files:**
- Create: `apps/web/src/lib/clients/derive-gradient.ts`
- Test: `apps/web/src/lib/clients/__tests__/derive-gradient.test.ts`

**Step 1 — Failing test:**
```ts
import { describe, it, expect } from "vitest";
import { deriveGradient, GRADIENT_TOKENS, type GradientToken } from "../derive-gradient";

describe("deriveGradient", () => {
  it("returns one of 6 known tokens", () => {
    const tokens: GradientToken[] = [
      "grad-rose", "grad-amber", "grad-slate",
      "grad-emerald", "grad-violet", "grad-indigo",
    ];
    expect(GRADIENT_TOKENS).toEqual(tokens);
  });

  it("is deterministic for the same name", () => {
    expect(deriveGradient("Noa Kirel")).toBe(deriveGradient("Noa Kirel"));
  });

  it("returns 'grad-slate' for empty input as a stable default", () => {
    expect(deriveGradient("")).toBe("grad-slate");
  });

  it("distributes names across all 6 tokens (smoke)", () => {
    const seen = new Set<string>();
    const names = ["Alice","Bob","Carol","Dan","Eve","Frank","Gina","Hugo","Iris","Jack","Kim","Liam"];
    for (const n of names) seen.add(deriveGradient(n));
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});
```

**Step 2 — Verify fail:**
```bash
pnpm -F web test -- derive-gradient 2>&1 | tail -10
```
Expected: FAIL — module not found.

**Step 3 — Implement (`apps/web/src/lib/clients/derive-gradient.ts`):**
```ts
// Deterministic name → 1-of-6 gradient token. Same FNV-31 hash style
// as ~/lib/_phase4-stubs/producer-color so a name's gradient stays
// stable across both surfaces.

export const GRADIENT_TOKENS = [
  "grad-rose",
  "grad-amber",
  "grad-slate",
  "grad-emerald",
  "grad-violet",
  "grad-indigo",
] as const;

export type GradientToken = (typeof GRADIENT_TOKENS)[number];

export function deriveGradient(name: string): GradientToken {
  if (!name) return "grad-slate";
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return GRADIENT_TOKENS[Math.abs(h) % GRADIENT_TOKENS.length] ?? "grad-slate";
}
```

**Step 4 — Verify pass:**
```bash
pnpm -F web test -- derive-gradient 2>&1 | tail -10
```
Expected: PASS (4 tests).

**Step 5 — Commit:**
```bash
git add apps/web/src/lib/clients/derive-gradient.ts apps/web/src/lib/clients/__tests__/derive-gradient.test.ts
git commit -m "$(cat <<'EOF'
feat(clients): deriveGradient helper — name → 1-of-6 gradient token

Pure deterministic mapping used by ClientCard + ProjectRow + the
Client Space hero. FNV-31 hash style matches producerHue so a name
gets a consistent visual identity across surfaces.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3 — `hero-bg.ts`

**Goal:** Map a `GradientToken` to its dark hero gradient (the prototype's `heroBg(grad)` map). Used by hero components for the full-bleed dark band behind the title.

**Files:**
- Create: `apps/web/src/lib/clients/hero-bg.ts`
- Test: `apps/web/src/lib/clients/__tests__/hero-bg.test.ts`

**Step 1 — Failing test:**
```ts
import { describe, it, expect } from "vitest";
import { heroBg } from "../hero-bg";
import { GRADIENT_TOKENS } from "../derive-gradient";

describe("heroBg", () => {
  it("returns a CSS linear-gradient string for every known token", () => {
    for (const tok of GRADIENT_TOKENS) {
      const v = heroBg(tok);
      expect(v.startsWith("linear-gradient(")).toBe(true);
    }
  });

  it("returns the prototype's exact slate hero gradient", () => {
    expect(heroBg("grad-slate")).toBe(
      "linear-gradient(140deg,#1E2330 0%, #2B3142 50%, #3F4A60 100%)",
    );
  });
});
```

**Step 2 — Verify fail.**

**Step 3 — Implement (`apps/web/src/lib/clients/hero-bg.ts`):**
```ts
// Dark hero gradient map — used by the dark gradient band behind
// the Client Space hero and the Album Page hero. Values verbatim
// from DESIGN.md §2 "Hero gradient map".

import type { GradientToken } from "./derive-gradient";

const MAP: Record<GradientToken, string> = {
  "grad-rose":    "linear-gradient(140deg,#5C1E26 0%, #7A2A20 50%, #B0381E 100%)",
  "grad-amber":   "linear-gradient(140deg,#3B2510 0%, #6B3F12 50%, #B06830 100%)",
  "grad-slate":   "linear-gradient(140deg,#1E2330 0%, #2B3142 50%, #3F4A60 100%)",
  "grad-violet":  "linear-gradient(140deg,#2B1C45 0%, #3B2868 50%, #5E3FAF 100%)",
  "grad-indigo":  "linear-gradient(140deg,#1B2353 0%, #2A3576 50%, #4252B0 100%)",
  "grad-emerald": "linear-gradient(140deg,#0F2C20 0%, #154A33 50%, #198455 100%)",
};

export function heroBg(token: GradientToken): string {
  return MAP[token];
}
```

**Step 4 — Verify pass.**

**Step 5 — Commit:**
```bash
git add apps/web/src/lib/clients/hero-bg.ts apps/web/src/lib/clients/__tests__/hero-bg.test.ts
git commit -m "feat(clients): heroBg map — gradient token → dark hero gradient"
```

---

## Part B — Atom components (Tasks 4-6)

### Task 4 — `LinkPill` component

**Goal:** Render one of 3 states (active / pending / none). The `none` state is a button that triggers the Invite modal (wired in Task 11 — for now the component accepts an `onInvite` callback prop).

**Files:**
- Create: `apps/web/src/components/dashboard/clients/link-pill.tsx`
- Test: `apps/web/src/components/dashboard/clients/__tests__/link-pill.test.tsx`

**Step 1 — Failing test (source-grep style):**
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, "../link-pill.tsx"), "utf-8");

describe("LinkPill", () => {
  it("exports a typed LinkPillState", () => {
    expect(SRC).toMatch(/export type LinkPillState\s*=\s*["']active["']\s*\|\s*["']pending["']\s*\|\s*["']none["']/);
  });

  it('renders "Linked" copy for active', () => {
    expect(SRC).toContain("Linked");
  });

  it('renders "Invited" copy for pending', () => {
    expect(SRC).toContain("Invited");
  });

  it('renders "Invite to app" copy for none', () => {
    expect(SRC).toContain("Invite to app");
  });

  it("calls onInvite for the none state via a button element", () => {
    expect(SRC).toMatch(/<button[^>]*onClick=\{onInvite\}/);
  });

  it("uses the Skitza fg-success token for the active dot", () => {
    expect(SRC).toContain("--fg-success");
  });

  it("uses the brand-primary token for the pending + none dots", () => {
    expect(SRC).toContain("--brand-primary");
  });

  it("forbids non-existent --surface-card token", () => {
    expect(SRC).not.toContain("--surface-card");
  });
});
```

**Step 2 — Verify fail.**

**Step 3 — Implement (`apps/web/src/components/dashboard/clients/link-pill.tsx`):**
```tsx
"use client";

import { ChevronRight } from "lucide-react";

export type LinkPillState = "active" | "pending" | "none";

interface LinkPillProps {
  state: LinkPillState;
  onInvite?: () => void;
}

export function LinkPill({ state, onInvite }: LinkPillProps) {
  if (state === "active") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide"
        style={{
          background: "rgb(var(--fg-success)/0.12)",
          borderColor: "rgb(var(--fg-success)/0.40)",
          color: "rgb(var(--fg-success))",
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "rgb(var(--fg-success))" }}
        />
        Linked
      </span>
    );
  }
  if (state === "pending") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide"
        style={{
          background: "rgb(var(--brand-primary)/0.12)",
          borderColor: "rgb(var(--brand-primary)/0.40)",
          color: "rgb(var(--brand-primary))",
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full animate-pulse"
          style={{ background: "rgb(var(--brand-primary))" }}
        />
        Invited
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onInvite}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide transition-colors hover:bg-[rgb(var(--brand-primary)/0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-background))]"
      style={{
        background: "rgb(var(--brand-primary)/0.10)",
        borderColor: "rgb(var(--brand-primary)/0.40)",
        color: "rgb(var(--brand-primary))",
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: "rgb(var(--brand-primary))" }}
      />
      Invite to app
      <ChevronRight size={12} />
    </button>
  );
}
```

**Step 4 — Verify pass.**

**Step 5 — Commit.**

### Task 5 — `StatTile` component

**Goal:** Uniform stat tile w/ label + value + optional sub-label. Variants: `default` / `danger` (rose tint) / `ok` (green tint).

**Files:**
- Create: `apps/web/src/components/dashboard/common/stat-tile.tsx`
- Test: `apps/web/src/components/dashboard/common/__tests__/stat-tile.test.tsx`

(Source-grep tests assert variants prop, accepts JSX children for value, uses correct tokens, no forbidden tokens. Mirror Task 4 test style.)

**Commit:** `feat(common): StatTile component for the new dashboard heroes`

### Task 6 — `HeroCTA` component

**Goal:** Two pill variants — `play` (solid white) and `upload` (frosted glass with backdrop-blur). Both `border-radius: 999px`.

**Files:**
- Create: `apps/web/src/components/dashboard/common/hero-cta.tsx`
- Test: `apps/web/src/components/dashboard/common/__tests__/hero-cta.test.tsx`

**Commit:** `feat(common): HeroCTA play + upload pill components`

---

## Part C — Row components (Tasks 7-8)

### Task 7 — `ProjectRow` component

**Goal:** The new `.proj` row from the prototype. Grid columns: `24px 44px minmax(0,1.6fr) minmax(0,1fr) 120px 100px 110px 36px` = grip · badge · title+tag+meta · client+email · progress · balance · deadline · chevron. `draggable="true"` for reorder.

**Files:**
- Create: `apps/web/src/components/dashboard/projects/project-row.tsx`
- Test: `apps/web/src/components/dashboard/projects/__tests__/project-row.test.tsx`

(Tests: assert grid columns class, draggable attribute, deriveGradient import, links to `/clients-projects/[id]`, all status pill types — pill-danger/warn/ok/neutral — present, no forbidden CSS tokens.)

**Commit:** `feat(projects): new ProjectRow component for the redesigned list`

### Task 8 — `ClientCard` component

**Goal:** New `.clicard` from the prototype. Avatar + name + LinkPill + email + 3-stat strip (Projects / Lifetime / Owed). Whole card is the link target; no inline CTAs.

**Files:**
- Create: `apps/web/src/components/dashboard/clients/client-card.tsx`
- Test: `apps/web/src/components/dashboard/clients/__tests__/client-card.test.tsx`

**Commit:** `feat(clients): new ClientCard component for the redesigned list`

---

## Part D — Composed surfaces (Tasks 9-10)

### Task 9 — `ClientSpaceHero` component

**Goal:** The dark gradient hero band at the top of the Client Space. Avatar (112px) + eyebrow CLIENT + name + LinkPill inline + meta line (email · phone · projects · joined date · context-aware invite CTA) + 4-tile stats row (Lifetime · Outstanding · Active projects · Joined). Right-side "+ New project" pill.

**Files:**
- Create: `apps/web/src/components/dashboard/clients/client-space-hero.tsx`
- Test: `apps/web/src/components/dashboard/clients/__tests__/client-space-hero.test.tsx`

**Commit:** `feat(clients): ClientSpaceHero — dark gradient hero replacing 4-tab header`

### Task 10 — `WorkspaceListView` component

**Goal:** The whole list view at `/clients-projects`. Owns: KPI strip (4 cards: Earnings / Outstanding / Needs attention / Next deadline), tab segmented control (Projects / Clients — default Projects per existing routing), filter chips, layout switcher (cards / table), sort dropdown (`custom` default), per-row drag-reorder handler. Composes ProjectRow + ClientCard.

**Files:**
- Create: `apps/web/src/components/dashboard/clients-projects/workspace-list-view.tsx`
- Test: `apps/web/src/components/dashboard/clients-projects/__tests__/workspace-list-view.test.tsx`

Drag handling: on `dragstart` capture the row's `data-id`; on `drop` compute new order array; dispatch tRPC `reorder` mutation (added in Tasks 14-15); flip sort to `custom` (URL: `?sort=custom`); optimistically update local state then revalidate.

**Commit:** `feat(clients-projects): new WorkspaceListView composes ProjectRow + ClientCard`

---

## Part E — Invite-to-App modal (Tasks 11-12)

### Task 11 — `InviteToAppModal` component (UI only)

**Goal:** Modal with client preview (avatar + name + email), primary "Send invite email" button, secondary "Copy invite link" button. If no email on file, dim the email row + auto-pick copy-link. Uses Radix Dialog (precedent: `DeleteConfirmModal` in store flow).

**Files:**
- Create: `apps/web/src/components/dashboard/clients/invite-modal.tsx`
- Test: `apps/web/src/components/dashboard/clients/__tests__/invite-modal.test.tsx`

The modal accepts `client: { id, name, email | null, gradient }` and `onClose` / `onSent` callbacks. Calls `clientContacts.sendInvite` mutation on email submit. Uses `navigator.clipboard.writeText` for copy-link with the URL `skitza.app/invite/<slug>-<id>` (slug from `producer.me()` — already available in shell state).

**Commit:** `feat(clients): InviteToAppModal — email + copy-link, dim email row when missing`

### Task 12 — Wire LinkPill `none` state → InviteToAppModal

Top-level wiring in `WorkspaceListView` and `ClientSpaceHero` — pass an `onInvite` handler down to `LinkPill` that opens the modal with the client's data.

**Files:**
- Modify: `apps/web/src/components/dashboard/clients-projects/workspace-list-view.tsx`
- Modify: `apps/web/src/components/dashboard/clients/client-space-hero.tsx`

(No new test file — extends existing tests.)

**Commit:** `feat(clients): wire LinkPill invite state to InviteToAppModal`

---

## Part F — tRPC mutations (Tasks 13-15)

### Task 13 — `clientContacts.sendInvite`

**Goal:** New mutation that sets `invited_at = now()` on the contact, emits a notification, and (if `via: "email"`) sends an invite email via Resend.

**Files:**
- Modify: `apps/web/src/server/trpc/routers/client-contacts.ts` (append the mutation)
- Test: `apps/web/src/server/trpc/routers/__tests__/client-contacts-send-invite.test.ts`

**Test (excerpt — DB-gated by `DATABASE_URL_TEST` per existing pattern):**
```ts
it("sets invited_at and emits a notification", async () => {
  // … set up producer + contact …
  await caller.clientContacts.sendInvite({ id: contact.id, via: "link" });
  const [updated] = await db.select().from(clientContacts).where(eq(clientContacts.id, contact.id));
  expect(updated.invitedAt).not.toBeNull();
  // … assert notification row emitted …
});
```

For "email" path: mock the Resend client (the codebase already uses a dispatcher at `apps/web/src/server/email/send.tsx` — pass an injectable mock).

**Commit:** `feat(trpc): clientContacts.sendInvite — sets invited_at, sends invite email`

### Task 14 — `clientContacts.reorder`

**Goal:** Atomic mutation that accepts an ordered array of client IDs and updates `position` on each. Match the precedent in `booking-packages-reorder.test.ts`.

**Files:**
- Modify: `apps/web/src/server/trpc/routers/client-contacts.ts`
- Test: `apps/web/src/server/trpc/routers/__tests__/client-contacts-reorder.test.ts`

**Commit:** `feat(trpc): clientContacts.reorder — drag-to-reorder mutation`

### Task 15 — `projects.reorder`

Same as Task 14, on `projects.position`.

**Files:**
- Modify: `apps/web/src/server/trpc/routers/project.ts`
- Test: `apps/web/src/server/trpc/routers/__tests__/projects-reorder.test.ts`

**Commit:** `feat(trpc): projects.reorder — drag-to-reorder mutation`

---

## Part G — Integration (Tasks 16-17)

### Task 16 — Replace `/clients-projects/page.tsx`

**Goal:** Server component fetches `listWithProjects` for both views (project list + clients list) + producer's slug + KPIs, then renders `<WorkspaceListView>`. Removes old imports of `ProjectsList` and `ClientsListScreen`. Removes the old header markup (now lives inside `WorkspaceListView`).

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/clients-projects/page.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/clients-projects/__tests__/page-shell.test.ts` (source-grep — asserts the new imports + that old imports are gone)

**Commit:** `feat(clients-projects): page.tsx renders new WorkspaceListView (replaces ProjectsList + ClientsListScreen)`

### Task 17 — Replace `/clients-projects/clients/[id]/page.tsx`

**Goal:** Same fold: server component fetches the client's `detail`, computes `nextSession` and the gradient via `deriveGradient(name)`, then renders `<ClientSpaceHero>` + `<ProjectRow>` rows below. **NO tabs.** Removes imports of `ClientDetailHeader`, `ClientDetailTabs`, `ClientOverviewPanel`, `ClientPaymentsPanel`, `ClientProjectsPanel`, `ClientNotesPanel`.

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/clients-projects/clients/[id]/page.tsx`
- Test: `apps/web/src/app/(producer)/dashboard/clients-projects/clients/[id]/__tests__/page-shell.test.ts`

**Commit:** `feat(clients): Client Space rebuilt as single page (drops 4-tab structure)`

---

## Part H — Deletion sweep (Task 18)

### Task 18 — Delete orphaned files

After Tasks 16-17 land, these files are unreachable:
- `apps/web/src/app/(producer)/dashboard/clients-projects/clients-page-tabs.tsx`
- `apps/web/src/app/(producer)/dashboard/clients-projects/clients-panel.tsx`
- `apps/web/src/app/(producer)/dashboard/clients-projects/clients-tab-key.ts`
- `apps/web/src/components/dashboard/projects/projects-list.tsx`
- `apps/web/src/components/dashboard/clients/clients-list-screen.tsx`
- `apps/web/src/components/dashboard/clients/detail/client-detail-header.tsx`
- `apps/web/src/components/dashboard/clients/detail/client-detail-tabs.tsx`
- `apps/web/src/components/dashboard/clients/detail/client-overview-panel.tsx`
- `apps/web/src/components/dashboard/clients/detail/client-payments-panel.tsx`
- `apps/web/src/components/dashboard/clients/detail/client-projects-panel.tsx`
- `apps/web/src/components/dashboard/clients/detail/client-notes-panel.tsx`
- `apps/web/src/lib/dashboard/client-detail-tab-key.ts`
- Any `__tests__` files exclusively covering the above
- Any `actions.ts` / `clients-actions.ts` server actions that were only consumed by the deleted panels

**Step 1 — Confirm zero callers:**
```bash
cd "/Users/giliasraf/Skitza 16.4"
for f in apps/web/src/components/dashboard/clients/detail/client-detail-header.tsx \
         apps/web/src/components/dashboard/clients/detail/client-detail-tabs.tsx \
         apps/web/src/components/dashboard/clients/detail/client-overview-panel.tsx \
         apps/web/src/components/dashboard/clients/detail/client-payments-panel.tsx \
         apps/web/src/components/dashboard/clients/detail/client-projects-panel.tsx \
         apps/web/src/components/dashboard/clients/detail/client-notes-panel.tsx \
         apps/web/src/components/dashboard/clients/clients-list-screen.tsx \
         apps/web/src/components/dashboard/projects/projects-list.tsx \
         apps/web/src/app/\(producer\)/dashboard/clients-projects/clients-panel.tsx \
         apps/web/src/app/\(producer\)/dashboard/clients-projects/clients-page-tabs.tsx \
         apps/web/src/app/\(producer\)/dashboard/clients-projects/clients-tab-key.ts \
         apps/web/src/lib/dashboard/client-detail-tab-key.ts; do
  base=$(basename "$f" .tsx)
  base=${base%.ts}
  echo "--- callers of $base ---"
  rg "from .*${base}" apps/web/src --type ts --type tsx 2>/dev/null | head -3
done
```
Expected: ALL "callers of X" sections empty.

**Step 2 — Delete:** `git rm` each file.

**Step 3 — Run typecheck + tests:**
```bash
pnpm typecheck && pnpm -F web test 2>&1 | tail -10
```
Expected: both green.

**Step 4 — Commit (single big deletion commit):**
```bash
git commit -m "$(cat <<'EOF'
chore(clients): delete obsolete files replaced by new Client Space + list view

12 files removed:
- 5 client-detail panels (Overview/Projects/Payments/Notes/Header)
- ClientDetailTabs + client-detail-tab-key
- ClientsListScreen + ProjectsList
- clients-page-tabs + clients-panel + clients-tab-key

These were the old 4-tab Client Space and the old ProjectsList /
ClientsListScreen components, replaced as part of the Phase 1
big-bang redesign.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Part I — Pipeline + PR (Tasks 19-20)

### Task 19 — `/skitza-verify`

```bash
cd "/Users/giliasraf/Skitza 16.4"
pnpm typecheck && pnpm -F web lint && pnpm test 2>&1 | tail -30
```
Expected: all 3 green. If any failure, fix and re-run.

**Common failure modes:**
- A deleted file is still imported somewhere unexpected. Find the importer and update.
- A new component uses a forbidden CSS token (`--surface-card` etc.). Replace with `--bg-elevated`.
- A tRPC test fails because `DATABASE_URL_TEST` isn't set locally — that's expected (these tests are gated). The CI pipeline runs them; we shouldn't.

### Task 20 — Push + open PR

```bash
git push -u origin clients-projects-phase-1 2>&1 | tail -5
```

Then:
```bash
gh pr create --base v3-clean --title "feat(clients-projects): v3 redesign — Phase 1 (big-bang visual rebuild + invite + drag)" --body "$(cat <<'EOF'
## Summary

Phase 1 of the Clients & Projects v3 redesign. **Big-bang visual rebuild.**

Replaces:
- The old `ProjectsList` (756 LOC) with a new `WorkspaceListView` + `ProjectRow`
- The old `ClientsListScreen` (302 LOC) with a `ClientCard` grid inside the same list view
- The 4-tab Client Space (`Overview / Projects / Payments / Notes`) with a single-page Client Space (dark hero + `LinkPill` + stats + project list)

Adds:
- `LinkPill` (active / pending / none — none opens the Invite modal)
- `InviteToAppModal` — Send invite email (Resend) + Copy invite link (clipboard)
- Drag-to-reorder for clients + projects (`clientContacts.reorder`, `projects.reorder`)
- Helpers: `deriveGradient` (name → token), `heroBg` (token → dark hero CSS)
- `StatTile`, `HeroCTA` (common atom components)

Removes (deleted in this PR):
- Old client-detail panels + header + tabs (8 files in `components/dashboard/clients/detail/`)
- `clients-page-tabs.tsx`, `clients-panel.tsx`, `clients-tab-key.ts`
- `client-detail-tab-key.ts`

## Why this is big

Gili approved a single-PR rebuild instead of three sub-PRs (1a/1b/1c) because the new design touches every visible surface in `/clients-projects/*` and partial migrations would leave the producer staring at a Frankenstein UI for days.

The data-layer side is small — only 3 new tRPC mutations and one source-grep test failing fixture. The bulk of the diff is new UI components built TDD-first.

## Design doc

[`docs/plans/active/2026-05-14-clients-projects-redesign-design.md`](docs/plans/active/2026-05-14-clients-projects-redesign-design.md)

## What was dropped intentionally

- Client Notes panel (`clientContacts.notes`, tags, referralSource columns stay in DB; no UI exposes them in Phase 1)
- Client Payments panel (per-project payment list — was duplicated info from Project Room)
- Client Overview panel (its stats now live in the hero)

Per Gili: "big bang, I want my new design, nothing from the old one."

## Test plan

- [x] All TDD tests green: pure helpers (deriveGradient, heroBg), component source-grep tests, tRPC procedure tests
- [x] `pnpm typecheck` — clean
- [x] `pnpm -F web lint` — zero warnings
- [x] `pnpm test` — all green
- [ ] Vercel preview manual QA in **Incognito** (memory: SW cache gotcha):
  - List view: KPIs render, filter chips work, sort dropdown defaults to Custom
  - Drag a project — sort flips to Custom, order persists on refresh
  - Drag a client — same behavior
  - Click a client with `linked: active` — green Linked pill
  - Click a client with `linked: pending` — amber pulsing Invited pill
  - Click a client with `linked: none` — amber Invite to app button → opens modal
  - Modal: Send email → sets invited_at, shows success toast, pill flips to Invited
  - Modal: Copy link → clipboard contains `skitza.app/invite/<slug>-<id>`, pill flips to Invited
  - Modal with no email on file — email row dimmed, copy-link still works
  - Client Space: dark hero with gradient, stats row, project list — no tabs visible
  - "+ New project" pill on Client Space hero → pre-fills the new-project form

## Files changed (high level)

- New: ~12 components + 2 helpers + 3 tRPC mutations + ~15 tests
- Modified: 2 page.tsx files (the two top-level pages this redesigns)
- Deleted: 12 obsolete files

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Report PR URL back to Gili.

---

## Done criteria

- [ ] Tasks 1-20 complete
- [ ] ~20 commits on branch (one per task plus a few sub-tasks)
- [ ] All gates green (`/skitza-verify`)
- [ ] PR opened against `v3-clean`
- [ ] Vercel preview link in PR comments
- [ ] No file outside `apps/web/` modified (Phase 0 already shipped the schema)

## Open follow-ups (not in Phase 1)

- The "Add Notes back" question — if Gili later wants client notes back, add a section to the Client Space below the project list, or a side drawer.
- Client Payments per-project rollup — currently dropped. If needed later, surface via the Album Page Payments tab (Phase 2 ships that).
- Drag accessibility (keyboard arrow navigation) — defer to fast-follow.

## Notes for execution

- **Don't rebuild `producerGradient`**. The avatar gradient (used by `ClientCard`, `ProjectRow` badge) comes from `~/lib/_phase4-stubs/producer-color.ts`. The dark hero gradient is the new `~/lib/clients/hero-bg.ts`. Two distinct systems.
- **Modal positioning**: use Radix `Dialog` per repo precedent (`apps/web/src/components/dashboard/store/delete-confirm-modal.tsx`). Center transform on `Dialog.Content`, scale/fade on inner wrapper (memory: storefront fixed a "top-left then snap to center" bug this way).
- **Drag positions**: the simplest representation is integers with gaps (`0, 10, 20, 30, …`) so insertions don't require renumbering. Reorder mutations atomically rewrite all positions in a transaction.
- **Source-grep tests are intentional**: no DOM rendering. Asserts the component file CONTAINS the expected import / class / attribute. Matches the existing repo pattern. Don't reach for `@testing-library/react` — it's not in the dev deps.
- **Vercel preview**: same branch name = same alias URL across pushes. Refresh in Incognito after each push.
