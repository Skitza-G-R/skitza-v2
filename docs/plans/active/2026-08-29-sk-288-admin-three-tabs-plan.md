# SK-288 — Admin: three real tabs

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cut the founder admin console from six tabs to three (Home, Users, Beta), delete the ~3,700-line fake-data layer, and remove the Live/Test URL split.

**Architecture:** Users and Beta already read the real database and are untouched. The fake Overview is replaced by a real Home that answers "what is waiting on me, and what is broken" using tables that already exist. Analytics, Payments and Health & history are deleted outright. The `[environment]` route segment is removed and admin talks to the live database only — **the database keeps its `live`/`test` column**, admin simply always writes `'live'`.

**Tech Stack:** Next.js 15 App Router, React 19, Drizzle, Vitest. Design doc: `docs/plans/active/2026-08-29-admin-three-tabs-design.md`.

**Branch:** `giasraf/sk-288-admin-cut-to-three-real-tabs-and-delete-the-demo-layer` (already created off `origin/v3-clean`).

**Verify after every task** — from `apps/admin`:

```
pnpm typecheck && pnpm lint && pnpm test
```

Vercel runs ESLint with `--max-warnings 0`. A warning breaks the deploy.

---

## Hard constraints

1. **No schema migration.** `system_problems`, `operational_runs`, `admin_action_history`, `admin_action_receipts` and `admin_support_notes` all carry a `NOT NULL` `admin_data_environment` column constrained to `IN ('live','test')`, plus unique indexes on `(environment, …)`. Do not drop, alter, or migrate any of it. Admin passes the literal `'live'` everywhere the environment was previously threaded from the URL.
2. **`purchase_reminder_deliveries` has no `failed` status.** Allowed values: `reserved`, `sending`, `sent`, `reservation_expired`, `dedupe_expired`. Never write a query filtering `status = 'failed'` on that table — it will silently return zero forever. Use the `last_failed_at` column and rows stuck in `sending`. `client_invitation_email_deliveries` is different: it *does* have `failed` plus a `failure_code`.
3. **Home must reuse the existing Users query**, not duplicate it. `src/server/registered-users/` already derives onboarding completeness and the 14-day activation window. Home counts and links into `/users?...`; it does not re-implement people logic.
4. **An empty Home is a success state.** When nothing needs attention the screen says so explicitly. Do not pad it with metrics to look busy.

---

## Task 1: Delete the dead Users screen

`src/features/dashboard/users-view.tsx` is 1,423 lines with zero importers — the old fake Users screen, replaced by the real one and never removed. Deleting it first proves the test harness works before anything risky.

**Files:**
- Delete: `apps/admin/src/features/dashboard/users-view.tsx`
- Delete: `apps/admin/src/features/dashboard/user-demo-workflows.ts`
- Delete: `apps/admin/src/features/dashboard/user-demo-workflows.test.ts`

**Step 1: Prove nothing imports it**

```bash
cd apps/admin
grep -rn "users-view\|UsersView\|user-demo-workflows" src --include="*.ts" --include="*.tsx" \
  | grep -v "^src/features/dashboard/users-view.tsx" \
  | grep -v "^src/features/dashboard/user-demo-workflows"
```

Expected: no output. If anything prints, stop and report it — the file is not dead and this plan is wrong.

**Step 2: Delete**

```bash
git rm apps/admin/src/features/dashboard/users-view.tsx \
       apps/admin/src/features/dashboard/user-demo-workflows.ts \
       apps/admin/src/features/dashboard/user-demo-workflows.test.ts
```

**Step 3: Verify**

Run: `cd apps/admin && pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass.

**Step 4: Commit**

```bash
git commit -m "refactor(admin): SK-288 delete the unreferenced demo users screen"
```

---

## Task 2: Delete the Analytics tab

**Files:**
- Delete: `apps/admin/src/app/(admin)/[environment]/analytics/page.tsx`
- Delete: `apps/admin/src/features/dashboard/analytics-view.tsx`
- Modify: `apps/admin/src/components/admin-navigation.tsx` — remove the `chart` entry from `ITEMS` and the `chart` key from the `paths` record in `NavigationIcon`

**Step 1: Delete the route and view**

```bash
git rm -r "apps/admin/src/app/(admin)/[environment]/analytics" \
          apps/admin/src/features/dashboard/analytics-view.tsx
```

**Step 2: Remove it from the sidebar**

In `admin-navigation.tsx`, delete the `{ icon: "chart", label: "Analytics", section: "analytics" }` entry and the `chart:` branch of `paths`. Removing the `ITEMS` entry alone leaves the icon type unused and ESLint will fail on it.

**Step 3: Verify**

Run: `cd apps/admin && pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass. A failing test that asserts six nav items is expected — update it to the new list rather than deleting the assertion.

**Step 4: Commit**

```bash
git commit -m "refactor(admin): SK-288 delete the fake Analytics tab"
```

---

## Task 3: Delete the Payments tab

Payment-proof verification belongs to the producer in the producer app. The founder has no role in it.

**Files:**
- Delete: `apps/admin/src/app/(admin)/[environment]/payments/` (both `page.tsx` and `[paymentId]/page.tsx`)
- Delete: `apps/admin/src/features/dashboard/payments-view.tsx`
- Modify: `apps/admin/src/components/admin-navigation.tsx` — remove the `payments` entry and icon

**Steps:** identical shape to Task 2.

**Commit:** `refactor(admin): SK-288 delete the fake Payments tab`

---

## Task 4: Delete the Health & history tab

The two or three facts worth knowing move onto Home in Task 5. Delete the tab now so Task 5 has nowhere to hide.

**Files:**
- Delete: `apps/admin/src/app/(admin)/[environment]/system-health/page.tsx`
- Delete: `apps/admin/src/features/dashboard/system-health-view.tsx`
- Modify: `apps/admin/src/components/admin-navigation.tsx` — remove the `pulse` entry and icon

**Careful:** do **not** delete the supporting API routes yet — `src/app/api/admin/system-problems/state/route.ts` and `src/app/api/admin/maintenance/history-retention/route.ts` are real and may be reused by Home. Leave them; Task 8 sweeps anything still unreferenced.

**Commit:** `refactor(admin): SK-288 delete the fake Health tab`

---

## Task 5: Build the real Home

This is the only task that writes new behaviour. Everything Home shows must be true, actionable by Gili, and invisible in PostHog/Sentry/Resend.

**Files:**
- Create: `apps/admin/src/server/home/queries.ts`
- Create: `apps/admin/src/server/home/queries.test.ts`
- Create: `apps/admin/src/features/home/home-view.tsx`
- Create: `apps/admin/src/features/home/view-model.ts`
- Create: `apps/admin/src/features/home/view-model.test.ts`
- Modify: `apps/admin/src/app/(admin)/[environment]/page.tsx` — stop calling `createFixtureAdminRepository`
- Delete: `apps/admin/src/features/dashboard/overview-view.tsx`

### What Home shows

Five rows maximum. Each is a count plus a link. No charts.

**Broken**

| Row | Source | Truthful test |
| --- | --- | --- |
| Open problems | `system_problems` | `environment = 'live' AND status <> 'resolved'` |
| Invitation emails failing | `client_invitation_email_deliveries` | `status = 'failed'`, last 7 days |
| Reminder emails stuck | `purchase_reminder_deliveries` | `last_failed_at IS NOT NULL` **or** `status = 'sending' AND claim_until < now()`, last 7 days. **Never** `status = 'failed'` — that value does not exist |
| Job has not run | `operational_runs` | newest row per `operation_name` where `kind = 'job'`; flag if `finished_at` is older than that job's expected interval, or `status IN ('failed','partial')` |

**Waiting on you**

| Row | Source | Link |
| --- | --- | --- |
| People not finished onboarding | existing `registered-users` directory query | `/users?onboarding=not-complete` |
| Beta invites with no signup | `beta_invitees` where `signed_up_at IS NULL AND invited_at < now() - 7 days` | `/beta` |

### Step 1: Write the failing view-model test

`src/features/home/view-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildHomeView } from "./view-model";

describe("buildHomeView", () => {
  it("reports a quiet console when nothing needs attention", () => {
    const view = buildHomeView({
      openProblems: 0,
      failedInvitationEmails: 0,
      stuckReminderEmails: 0,
      staleJobs: [],
      onboardingIncomplete: 0,
      betaInvitesWithoutSignup: 0,
    });

    expect(view.quiet).toBe(true);
    expect(view.rows).toHaveLength(0);
  });

  it("lists only the signals that are non-zero", () => {
    const view = buildHomeView({
      openProblems: 2,
      failedInvitationEmails: 0,
      stuckReminderEmails: 5,
      staleJobs: [],
      onboardingIncomplete: 0,
      betaInvitesWithoutSignup: 3,
    });

    expect(view.quiet).toBe(false);
    expect(view.rows.map((row) => row.id)).toEqual([
      "open-problems",
      "stuck-reminder-emails",
      "beta-invites-without-signup",
    ]);
  });

  it("puts broken things above people waiting", () => {
    const view = buildHomeView({
      openProblems: 0,
      failedInvitationEmails: 1,
      stuckReminderEmails: 0,
      staleJobs: [],
      onboardingIncomplete: 4,
      betaInvitesWithoutSignup: 0,
    });

    expect(view.rows.map((row) => row.tone)).toEqual(["broken", "waiting"]);
  });
});
```

### Step 2: Run it and watch it fail

Run: `cd apps/admin && pnpm vitest run src/features/home/view-model.test.ts`
Expected: FAIL — `Failed to resolve import "./view-model"`.

### Step 3: Write the minimal view model

`src/features/home/view-model.ts`:

```ts
export type HomeSignals = Readonly<{
  openProblems: number;
  failedInvitationEmails: number;
  stuckReminderEmails: number;
  staleJobs: readonly string[];
  onboardingIncomplete: number;
  betaInvitesWithoutSignup: number;
}>;

export type HomeRow = Readonly<{
  id: string;
  tone: "broken" | "waiting";
  label: string;
  count: number;
  href: string;
}>;

export type HomeView = Readonly<{ quiet: boolean; rows: readonly HomeRow[] }>;

export function buildHomeView(signals: HomeSignals): HomeView {
  const candidates: readonly HomeRow[] = [
    {
      id: "open-problems",
      tone: "broken",
      label: "Open problems",
      count: signals.openProblems,
      href: "/users",
    },
    {
      id: "failed-invitation-emails",
      tone: "broken",
      label: "Invitation emails that failed to send",
      count: signals.failedInvitationEmails,
      href: "/users",
    },
    {
      id: "stuck-reminder-emails",
      tone: "broken",
      label: "Reminder emails stuck mid-send",
      count: signals.stuckReminderEmails,
      href: "/users",
    },
    {
      id: "stale-jobs",
      tone: "broken",
      label: "Scheduled jobs that have not run",
      count: signals.staleJobs.length,
      href: "/users",
    },
    {
      id: "onboarding-incomplete",
      tone: "waiting",
      label: "People who never finished onboarding",
      count: signals.onboardingIncomplete,
      href: "/users?onboarding=not-complete",
    },
    {
      id: "beta-invites-without-signup",
      tone: "waiting",
      label: "Beta invites with no signup",
      count: signals.betaInvitesWithoutSignup,
      href: "/beta",
    },
  ];

  const rows = candidates.filter((row) => row.count > 0);
  return { quiet: rows.length === 0, rows };
}
```

### Step 4: Run the test again

Run: `cd apps/admin && pnpm vitest run src/features/home/view-model.test.ts`
Expected: PASS.

### Step 5: Commit the view model before touching the database

```bash
git add apps/admin/src/features/home/
git commit -m "feat(admin): SK-288 home view model over real signals"
```

### Step 6: Write the queries

`src/server/home/queries.ts` — one exported `loadHomeSignals(db)` returning `HomeSignals`. Follow the connection and error style already used in `src/server/registered-users/repository.ts`; do not invent a new database helper. Pass the literal `'live'` for every `environment` filter.

Re-read constraint 2 before writing the reminder-email query.

For onboarding counts, call the existing registered-users directory query with `onboarding: "not-complete"` and read its total — do not write new people SQL.

### Step 7: Test the queries against the shapes, not a live database

`src/server/home/queries.test.ts` — assert the generated SQL never contains `'failed'` alongside `purchase_reminder_deliveries`, and that every query filters `environment = 'live'`. These two tests are the regression guard for the constraints above.

### Step 8: Wire the page and delete the fixture overview

Rewrite `[environment]/page.tsx` to call `loadHomeSignals` → `buildHomeView` → `<HomeView />`. Delete `overview-view.tsx`.

### Step 9: Verify and commit

Run: `cd apps/admin && pnpm typecheck && pnpm lint && pnpm test`

```bash
git commit -m "feat(admin): SK-288 replace the fixture overview with a real home screen"
```

---

## Task 6: Delete the fixture layer

Nothing should import it now.

**Files:**
- Delete: `apps/admin/src/features/dashboard/demo-repository.ts` + `.test.ts`
- Delete: `apps/admin/src/features/dashboard/operations-demo.ts` + `.test.ts`
- Delete: `apps/admin/src/lib/admin-demo-view-models.ts`
- Delete: `apps/admin/src/features/dashboard/shared.tsx` (fixture-only)
- Modify: `apps/admin/src/features/dashboard/dashboard-interactions.tsx` — remove `SimulatedNotice` and any other demo-only export; keep whatever the layout still uses

**Step 1: Prove they are orphaned**

```bash
cd apps/admin
grep -rn "demo-repository\|admin-demo-view-models\|operations-demo\|SimulatedNotice\|dashboard/shared" src \
  --include="*.ts" --include="*.tsx" | grep -v "^src/features/dashboard/" | grep -v "^src/lib/admin-demo-view-models.ts"
```

Expected: no output.

**Step 2–4:** delete, verify, commit as `refactor(admin): SK-288 delete the demo fixture layer`.

---

## Task 7: Collapse Live/Test

**Files:**
- Move: every route under `src/app/(admin)/[environment]/` up to `src/app/(admin)/`
- Modify: `src/app/(admin)/page.tsx` — was the environment chooser, becomes Home
- Delete: `src/components/environment-choice.tsx`, `src/components/environment-switcher.tsx`, `src/features/dashboard/route-environment.ts`
- Modify: `src/server/environment/index.ts` — keep one `ADMIN_LIVE_DATABASE_URL` binding; delete `ADMIN_TEST_DATABASE_URL`, the collision check, and `parseAdminEnvironmentId`
- Modify: `src/server/registered-users/clerk-environment.ts` — keep only the `ADMIN_LIVE_CLERK_*` bindings
- Modify: `src/components/admin-navigation.tsx` — hrefs lose the `/${environment}` prefix
- Modify: `.env.example` and `README.md` — delete every `ADMIN_TEST_*` line and the Live/Test paragraphs

**Do not touch `packages/db`.** The `admin_data_environment` enum, its columns, its check constraints and its unique indexes all stay. Admin writes the literal `'live'`.

**Step 1:** delete the tests that assert Test-environment behaviour (`truthful-environment-copy.test.ts` and the environment cases in `src/server/environment/*.test.ts`), and keep the tests proving the live binding is required.

**Step 2:** verify `grep -rn "ADMIN_TEST\|\[environment\]\|/live/" apps/admin/src` returns nothing.

**Step 3:** verify and commit as `refactor(admin): SK-288 collapse the Live/Test split to one environment`.

---

## Task 8: Sweep the orphans

Anything left unreferenced after Tasks 1–7: the `api/admin/system-problems/state` and `api/admin/maintenance/history-retention` routes if Home did not adopt them, and any now-unused CSS in the admin stylesheet.

```bash
cd apps/admin && pnpm lint
```

Delete only what is provably unreferenced. Commit as `refactor(admin): SK-288 remove orphaned admin routes`.

---

## Task 9: Verify, open the PR, then hand back

**Step 1: Full gate**

```bash
cd apps/admin && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Every command must pass. Report the exact failing command if any does — never paper over a baseline failure.

**Step 2: Count what went**

```bash
git diff --stat origin/v3-clean...HEAD | tail -1
```

Expected: roughly 3,700 deletions in `apps/admin`.

**Step 3: Open the PR**

```bash
gh pr create --base v3-clean \
  --title "SK-288: cut admin to three real tabs and delete the demo layer" \
  --body "..."
```

**Step 4: Stop.** Do not merge and do not promote. Ask Gili.

**Step 5: Tell Gili the two manual steps only she can do**

1. Delete every `ADMIN_TEST_*` variable from the admin Vercel project **after** the deploy is green — they are marked Sensitive and cannot be read or removed from here.
2. Confirm nothing else consumed the Test database before it is decommissioned.
