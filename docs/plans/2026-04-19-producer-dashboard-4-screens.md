# Producer Dashboard 4-Screen Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Collapse the producer dashboard from 10 top-level nav items into 4 screens (Today / Project Room / Music / Setup) + a global command layer. Pure UI refactor — no schema changes, no new tRPC procedures required.

**Architecture:** Four route surfaces remain: `/dashboard` (Today), `/dashboard/projects/<id>` (Project Room), `/dashboard/music` (new), `/dashboard/settings` (Setup). Every other top-level dashboard route becomes a 301/302 redirect to its new home inside these 4 screens. Sub-tabs inside Project Room absorb Contracts / Invoices / Bookings / Notes. Existing `CommandPaletteTrigger`, `ShortcutsBridge`, and `PersistentPlayer` components stay — they get rewired to reach 4 destinations instead of 10.

**Tech Stack:** Next.js 15 App Router (RSC + Server Actions), tRPC v11 (existing routers reused as-is), Drizzle ORM + Neon Postgres, Tailwind v4 + CSS vars, `cmdk` (already installed), Vitest. Reuses everything from the auto-installments + artist-app builds — most notably the payment status strip, the waveform player, the plan picker.

**Design doc:** `docs/plans/2026-04-19-producer-dashboard-4-screens-design.md` — read before starting.

---

## Prerequisites

Before Task 1, the engineer should:

1. Read the design doc. Every "why" question has its answer there.
2. Confirm baseline is green on `main`:
   ```bash
   cd "/Users/giliasraf/Skitza 16.4/apps/web" && pnpm test && pnpm typecheck && pnpm lint
   ```
   Expected: **429 passing | 4 skipped**, clean typecheck + lint. (Baseline grew through the artist-app PR + the two hotfixes `28dabbb` on main.)
3. Skim the existing dashboard surface. Current routes under `apps/web/src/app/(app)/dashboard/`:
   - `page.tsx` (landing — becomes Today)
   - `projects/[id]/page.tsx` (existing project detail — becomes Project Room)
   - `settings/page.tsx` (evolves into Setup)
   - `booking/`, `clients/`, `contracts/`, `deals/`, `inbox/`, `invoices/`, `leads/`, `library/`, `portfolio/`, `onboarding/` — **these all get removed or redirected**
4. Read `apps/web/src/components/shell/app-shell.tsx` + `sidebar.tsx` + `command-palette.tsx` — the shell already has ⌘K wiring. We're rewiring it, not rebuilding.
5. Know that `/dashboard/onboarding` is the first-run producer wizard — **preserved** (it's a setup flow, not a top-level tab).

### Project conventions (same as prior builds)

- **Tests beside code**: `foo.ts` → `foo.test.ts` or `__tests__/foo.test.ts` depending on what the surrounding directory does.
- **tRPC**: producer-scoped routers use `producerProcedure` from `~/server/trpc/producer-procedure`. No new routers this refactor — only existing ones consumed differently.
- **CSS vars, not hex**: `rgb(var(--brand-primary))`, `rgb(var(--bg-elevated))`, `rgb(var(--fg-secondary))`, etc.
- **Commit discipline**: frequent small commits, fail-first tests, TDD red/green captured in report.
- **No new dependencies** — `cmdk` is already installed.
- **Mobile-first**: every screen must look right at 360px before it's tested at 1280px.

---

## Branch setup

Before Task 1, the controller session will create the feature branch. Engineer does NOT branch again — commits land directly on `feat/producer-dashboard-4-screens`.

---

## Task 1: Sidebar + AppShell — collapse the 10 nav items to 4

**Files:**
- Modify: `apps/web/src/components/shell/sidebar.tsx`
- Modify: `apps/web/src/components/shell/app-shell.tsx` (the `active` prop type)
- Test: `apps/web/src/components/shell/__tests__/sidebar.test.tsx` (create if missing)

### Step 1.1: Find the current nav item list

Open `apps/web/src/components/shell/sidebar.tsx`. Locate the array of nav items (likely something like `const NAV_ITEMS = [{ label: "Pipeline", href: "/dashboard", ... }, ...]`). Count them — should be ~10.

### Step 1.2: Write a failing test

Create `apps/web/src/components/shell/__tests__/sidebar.test.tsx` (skip creation if the file already exists):

```tsx
import { describe, it, expect } from "vitest";
import { NAV_ITEMS } from "../sidebar";  // will fail until we export it

describe("Sidebar NAV_ITEMS", () => {
  it("contains exactly 4 top-level items", () => {
    expect(NAV_ITEMS).toHaveLength(4);
  });

  it("has the 4 canonical labels in order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Today", "Music", "Projects", "Setup"]);
  });

  it("maps each item to its route", () => {
    expect(NAV_ITEMS.find((i) => i.label === "Today")?.href).toBe("/dashboard");
    expect(NAV_ITEMS.find((i) => i.label === "Music")?.href).toBe("/dashboard/music");
    expect(NAV_ITEMS.find((i) => i.label === "Projects")?.href).toBe("/dashboard/projects");
    expect(NAV_ITEMS.find((i) => i.label === "Setup")?.href).toBe("/dashboard/settings");
  });
});
```

Note: "Projects" appears as a nav item even though Project Room is always per-project. Clicking Projects opens a list view inside Today (a saved view called "All projects"), OR the Music tab if you prefer. Per the design doc, we're surfacing Projects as nav for discoverability — see the `DESIGN NOTE` section below.

**DESIGN NOTE** — after reading the design doc: the 4 screens are Today / Project Room / Music / Setup. "Project Room" isn't a top-level nav item because it's always per-project. The 4 nav items are: **Today · Music · Projects · Setup**, where "Projects" is a list view (filtered saved view on Today) that lets the producer browse all projects by stage — functionally the replacement for the Kanban. Tapping a project opens its Project Room.

If you prefer 3 nav items (Today · Music · Setup) and reach Projects only via Today, that's defensible too — but 4 is the user's stated count. Proceed with 4.

### Step 1.3: Run test, verify fail

```bash
cd "/Users/giliasraf/Skitza 16.4/apps/web" && pnpm test src/components/shell/__tests__/sidebar.test.tsx
```

Expected: FAIL. Capture verbatim.

### Step 1.4: Rewrite the nav list

In `apps/web/src/components/shell/sidebar.tsx`:
- Export `NAV_ITEMS` as a typed const array
- Keep only 4 items: Today / Music / Projects / Setup
- Drop icons/labels for the 6 killed items (Pipeline, Portfolio, Leads, Booking, Contracts, Clients, Library, Inbox, Invoices)

```ts
export const NAV_ITEMS = [
  { label: "Today",    href: "/dashboard",            icon: "🏠" },
  { label: "Music",    href: "/dashboard/music",      icon: "🎵" },
  { label: "Projects", href: "/dashboard/projects",   icon: "📁" },
  { label: "Setup",    href: "/dashboard/settings",   icon: "⚙️" },
] as const;
```

Update the Sidebar component body to render from `NAV_ITEMS` (loop, not hardcoded).

### Step 1.5: Update the `active` prop type in AppShell

In `apps/web/src/components/shell/app-shell.tsx`, change:
```ts
active: "pipeline" | "portfolio" | "leads" | "booking" | "contracts" | "clients" | "library" | "settings" | "inbox" | "invoices";
```
to:
```ts
active: "today" | "music" | "projects" | "setup";
```

This is a **breaking change** to the `active` prop — every page using `AppShell` will fail typecheck. That's intentional; we'll fix each consumer in the tasks that refactor those pages. For now, leave `AppShell` broken and move on.

Temporary measure: in each page file that still references the old `active` value (you'll see them in typecheck failures), replace the old value with one of the four new ones mapped as follows:
- `"pipeline"` → `"today"`
- `"portfolio"`, `"settings"` → `"setup"`
- `"leads"`, `"clients"`, `"inbox"`, `"invoices"` → `"today"` (they're about to be killed)
- `"booking"`, `"contracts"` → `"projects"` (they're about to be absorbed)
- `"library"` → `"music"`

### Step 1.6: Verify

```bash
cd "/Users/giliasraf/Skitza 16.4/apps/web" && pnpm test src/components/shell/__tests__/sidebar.test.tsx
pnpm typecheck  # will have many errors in pages using old `active` — expected
```

Sidebar test: PASS (3/3). Typecheck: expected failures in old pages. Don't chase them yet — Task 2 starts killing those pages.

### Step 1.7: Commit

```bash
cd "/Users/giliasraf/Skitza 16.4"
git add apps/web/src/components/shell/
git commit -m "$(cat <<'EOF'
refactor(shell): collapse sidebar from 10 items to 4

Today · Music · Projects · Setup. All 6 removed items (Pipeline,
Portfolio, Leads, Booking, Contracts, Clients, Library, Inbox,
Invoices) become either sub-tabs of Project Room, filtered views
on Today, or redirect-only routes — handled in subsequent tasks.

AppShell's `active` prop type narrowed to the new 4 values.
Downstream pages using the old values now fail typecheck — that's
intentional; each gets refactored in its own task before we're
green again.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 301/302 redirects for the 9 killed top-level routes

**Files:**
- Modify: `apps/web/src/middleware.ts` (add the redirect matcher map)
- Test: `apps/web/src/middleware.test.ts` (new — cover each redirect)
- Delete: all the old `page.tsx` files under the killed routes (we replace them with middleware redirects so directory traversal can't reach them)

### Step 2.1: Write failing middleware test

Create `apps/web/src/middleware.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveLegacyRedirect } from "./middleware";

describe("resolveLegacyRedirect", () => {
  it.each([
    ["/dashboard/pipeline",   "/dashboard"],
    ["/dashboard/clients",    "/dashboard"],
    ["/dashboard/leads",      "/dashboard"],
    ["/dashboard/bookings",   "/dashboard"],
    ["/dashboard/contracts",  "/dashboard"],
    ["/dashboard/invoices",   "/dashboard"],
    ["/dashboard/inbox",      "/dashboard"],
    ["/dashboard/library",    "/dashboard/music"],
    ["/dashboard/portfolio",  "/dashboard/settings?section=portfolio"],
    ["/dashboard/booking",    "/dashboard/settings?section=availability"],
  ])("redirects %s → %s", (from, to) => {
    expect(resolveLegacyRedirect(from)).toBe(to);
  });

  it("returns null for unknown paths", () => {
    expect(resolveLegacyRedirect("/dashboard")).toBe(null);
    expect(resolveLegacyRedirect("/dashboard/projects/abc")).toBe(null);
    expect(resolveLegacyRedirect("/random")).toBe(null);
  });

  it("preserves dynamic segments for ID-based routes", () => {
    // /dashboard/contracts/<uuid> → /dashboard/projects/<uuid>?tab=money
    // since we don't know the project id from the contract id at middleware
    // level, we redirect to /dashboard and let the landing resolve or show
    // a "we moved this" toast. Simpler than joining across tables in the
    // middleware.
    expect(resolveLegacyRedirect("/dashboard/contracts/abc-123")).toBe("/dashboard");
    expect(resolveLegacyRedirect("/dashboard/leads/xyz")).toBe("/dashboard");
    expect(resolveLegacyRedirect("/dashboard/clients/zzz")).toBe("/dashboard");
  });
});
```

### Step 2.2: Verify RED

```bash
cd "/Users/giliasraf/Skitza 16.4/apps/web" && pnpm test src/middleware.test.ts
```

Expected: FAIL with "resolveLegacyRedirect is not a function" (because we haven't exported it yet).

### Step 2.3: Add `resolveLegacyRedirect` + wire into middleware

Modify `apps/web/src/middleware.ts`:

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtected = createRouteMatcher([
  "/dashboard(.*)",
  "/projects(.*)",
  "/settings(.*)",
  "/onboarding(.*)",
  "/artist(.*)",
  "/artist-welcome(.*)",
]);

// Legacy → new-shape redirect map. Keys are EXACT paths (no regex) plus
// a dynamic-segment fallback for ID-based routes. Everything in this
// table was a top-level dashboard nav item before the 4-screen
// refactor and is now either a sub-tab of Project Room, a filtered
// view on Today, or merged into Setup. Emailed links + bookmarks
// land here — returning a 301 keeps them working.
const STATIC_REDIRECTS: Record<string, string> = {
  "/dashboard/pipeline":  "/dashboard",
  "/dashboard/clients":   "/dashboard",
  "/dashboard/leads":     "/dashboard",
  "/dashboard/bookings":  "/dashboard",  // plural — never existed but listed for safety
  "/dashboard/contracts": "/dashboard",
  "/dashboard/invoices":  "/dashboard",
  "/dashboard/inbox":     "/dashboard",
  "/dashboard/library":   "/dashboard/music",
  "/dashboard/portfolio": "/dashboard/settings?section=portfolio",
  "/dashboard/booking":   "/dashboard/settings?section=availability",
};

// Dynamic paths — /dashboard/contracts/<id> etc. We collapse them all
// to /dashboard (the user lands on Today and can search for what they
// wanted). Joining contracts → projects in the middleware would require
// a DB round-trip on every redirect, which is bad. The simpler
// fallback is "land on Today, use ⌘K or the search if you need to
// find something specific." The PR doc mentions this as a conscious
// trade-off.
const DYNAMIC_PREFIXES = [
  "/dashboard/contracts/",
  "/dashboard/leads/",
  "/dashboard/clients/",
  "/dashboard/deals/",      // legacy — predates the projects rename
];

export function resolveLegacyRedirect(pathname: string): string | null {
  if (STATIC_REDIRECTS[pathname] !== undefined) {
    return STATIC_REDIRECTS[pathname];
  }
  for (const prefix of DYNAMIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return "/dashboard";
  }
  return null;
}

export default clerkMiddleware(async (auth, req) => {
  // Legacy redirects BEFORE auth gating — returning a 301 is cheap and
  // the target is always inside /dashboard which is also protected.
  const legacy = resolveLegacyRedirect(req.nextUrl.pathname);
  if (legacy !== null) {
    const url = new URL(legacy, req.url);
    return NextResponse.redirect(url, 301);
  }

  if (isProtected(req)) {
    const target = req.nextUrl.pathname + req.nextUrl.search;
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect_url", target);
    await auth.protect({ unauthenticatedUrl: signInUrl.toString() });
  }
});

export const config = { matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"] };
```

### Step 2.4: Verify tests GREEN

```bash
cd "/Users/giliasraf/Skitza 16.4/apps/web" && pnpm test src/middleware.test.ts
```

Expected: 11 passing (10 redirect cases + 1 "unknown paths" + the dynamic-segment trio).

### Step 2.5: Delete the old page files

The middleware will redirect before Next.js reaches these pages, but leaving them in the tree means typecheck still tries to compile them AND their `active` prop references are dead code. Delete:

```bash
rm -rf apps/web/src/app/\(app\)/dashboard/clients
rm -rf apps/web/src/app/\(app\)/dashboard/leads
rm -rf apps/web/src/app/\(app\)/dashboard/contracts
rm -rf apps/web/src/app/\(app\)/dashboard/invoices
rm -rf apps/web/src/app/\(app\)/dashboard/inbox
rm -rf apps/web/src/app/\(app\)/dashboard/library
rm -rf apps/web/src/app/\(app\)/dashboard/portfolio
rm -rf apps/web/src/app/\(app\)/dashboard/deals
```

Do **NOT** delete:
- `apps/web/src/app/(app)/dashboard/page.tsx` — becomes Today (Task 3)
- `apps/web/src/app/(app)/dashboard/projects/` — becomes Project Room (Task 5)
- `apps/web/src/app/(app)/dashboard/settings/` — becomes Setup (Task 9)
- `apps/web/src/app/(app)/dashboard/booking/` — its files get merged into Setup + Project Room's Sessions sub-tab in later tasks; keep for now so we don't break the currently-working Task 14 edit-product UI from the artist-app PR
- `apps/web/src/app/(app)/dashboard/onboarding/` — first-run wizard, preserved

### Step 2.6: Verify by curl against dev server

Spin up the dev server for a second:
```bash
cd "/Users/giliasraf/Skitza 16.4/apps/web" && pnpm dev &
DEVPID=$!
sleep 6
for p in /dashboard/clients /dashboard/leads /dashboard/contracts /dashboard/invoices /dashboard/inbox /dashboard/library /dashboard/portfolio; do
  echo -n "$p → "
  curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "http://localhost:3000$p"
done
kill $DEVPID 2>/dev/null
```

Expected: each returns `301` with the right redirect URL in the Location header.

### Step 2.7: Commit

```bash
cd "/Users/giliasraf/Skitza 16.4"
git add apps/web/src/middleware.ts apps/web/src/middleware.test.ts
git rm -rf apps/web/src/app/\(app\)/dashboard/clients
git rm -rf apps/web/src/app/\(app\)/dashboard/leads
git rm -rf apps/web/src/app/\(app\)/dashboard/contracts
git rm -rf apps/web/src/app/\(app\)/dashboard/invoices
git rm -rf apps/web/src/app/\(app\)/dashboard/inbox
git rm -rf apps/web/src/app/\(app\)/dashboard/library
git rm -rf apps/web/src/app/\(app\)/dashboard/portfolio
git rm -rf apps/web/src/app/\(app\)/dashboard/deals
git commit -m "$(cat <<'EOF'
refactor(dashboard): kill 8 legacy routes, add 301 redirects

Middleware now 301-redirects every legacy dashboard route to its
new home:
- pipeline/clients/leads/bookings/contracts/invoices/inbox → /dashboard
- library → /dashboard/music
- portfolio → /dashboard/settings?section=portfolio
- booking (availability config) → /dashboard/settings?section=availability
- dynamic-segment routes (/dashboard/contracts/<id>, etc.) → /dashboard

The dynamic-segment fallback trades "lands on exact target" for
"no DB round-trip in middleware." The landing surface has search
(⌘K) that can find anything by name in 1 second, so the loss is
minimal.

Old page files deleted so typecheck no longer chases them.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Today — split-inbox layout + KPI strip

**Files:**
- Rewrite: `apps/web/src/app/(app)/dashboard/page.tsx` (the current Kanban landing becomes Today)
- Create: `apps/web/src/components/dashboard/today/today-view.tsx`
- Create: `apps/web/src/components/dashboard/today/kpi-strip.tsx`
- Create: `apps/web/src/components/dashboard/today/today-list.tsx`
- Create: `apps/web/src/components/dashboard/today/today-detail.tsx`
- Modify: `apps/web/src/server/trpc/routers/producer.ts` (add `today` procedure if it doesn't exist; it likely already exposes the right data via `home`-ish procedures)
- Delete (at end of Task): `apps/web/src/app/(app)/dashboard/kanban.tsx`, `kanban-helpers.ts`, `upcoming-strip.tsx`, `revenue-tile.tsx` — superseded

### Step 3.1: Design the `producer.today` tRPC procedure

Check whether the existing producer router has a `today`-shaped procedure. Grep:

```bash
grep -rn "today\|upcoming\|dashboard" apps/web/src/server/trpc/routers/ --include="*.ts" | head
```

If a `producer.today` procedure exists, extend it. Otherwise create one. Return shape:

```ts
{
  kpis: {
    activeProjects: number;
    revenueMonthCents: number;
    revenueCurrency: string;
    upcomingSessions7d: number;
    unresolvedItems: number;  // unpaid invoices + open comments
  };
  items: Array<{
    id: string;                     // unique per item
    kind: "session" | "comment" | "invoice" | "lead";
    title: string;
    subtitle: string;
    occurredAt: Date;
    href: string;                   // Project Room deep-link
    unread: boolean;
  }>;  // max 50, sorted by urgency (upcoming sessions first, then unread comments, then overdue invoices)
  savedViews: Array<{ id: string; label: string; filter: Record<string, string> }>;
}
```

`savedViews` can be empty `[]` for this pass — saving them requires a new table (deferred per design doc). The UI renders the dropdown with just "All" as the default for now.

### Step 3.2: Write failing test for `producer.today`

Create `apps/web/src/server/trpc/routers/__tests__/producer-today.test.ts` (extend `producer.test.ts` if it exists).

Mirror the mock-DB pattern from `artist-home.test.ts` (use `findPredicate` for auth scoping). Cover:

1. Returns zeroed KPIs + empty items when producer has no projects
2. Upcoming sessions counted within 7-day window
3. Unpaid invoices + open comments sum into unresolvedItems
4. Items sorted by urgency (session > comment > invoice)
5. Auth scoping (producerProcedure + WHERE clauses on `producerId`)

### Step 3.3: Run test RED, implement, run GREEN

Same pattern as artist-home. Aggregate via `Promise.all` across 4 parallel queries.

### Step 3.4: KPI strip component

Create `apps/web/src/components/dashboard/today/kpi-strip.tsx`:

```tsx
// Server Component — pure projection of KPI numbers.
type Props = {
  kpis: {
    activeProjects: number;
    revenueMonthCents: number;
    revenueCurrency: string;
    upcomingSessions7d: number;
    unresolvedItems: number;
  };
};

export function KpiStrip({ kpis }: Props) {
  const format = (c: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: kpis.revenueCurrency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(c / 100);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Kpi label="Active projects"   value={String(kpis.activeProjects)} />
      <Kpi label="Revenue · month"   value={format(kpis.revenueMonthCents)} />
      <Kpi label="Sessions · 7d"     value={String(kpis.upcomingSessions7d)} />
      <Kpi label="Unresolved"        value={String(kpis.unresolvedItems)} tone={kpis.unresolvedItems > 0 ? "warn" : "default"} />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "default" | "warn" }) {
  return (
    <div className="rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <p className="font-mono text-[0.62rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">{label}</p>
      <p className={`mt-1 font-display text-2xl tracking-tight ${tone === "warn" ? "text-[rgb(var(--fg-warning))]" : ""}`}>{value}</p>
    </div>
  );
}
```

### Step 3.5: Today list + detail (split-inbox)

Create `apps/web/src/components/dashboard/today/today-list.tsx` — renders the items array as rows with icon + title + subtitle + relative-time stamp. Tapping a row updates `?itemId=<id>` in the URL (client component using `useRouter`).

Create `apps/web/src/components/dashboard/today/today-detail.tsx` — reads `?itemId` from `searchParams`, finds that item in the list, renders a detail view with:
- Larger title + subtitle
- Deep-link button ("Open in Project Room")
- If `kind === "comment"`: inline reply form
- If `kind === "session"`: Waze link + "Reschedule"
- If `kind === "invoice"`: Stripe link + "Mark paid manually"
- If `kind === "lead"`: "Accept" / "Ignore" buttons

### Step 3.6: Compose Today view

Create `apps/web/src/components/dashboard/today/today-view.tsx`:

```tsx
// Orchestrates: KPI strip (top) + split-inbox (list + detail) below.
// Desktop: 2-column grid, list left, detail right.
// Mobile: list only; tapping an item navigates to ?itemId + scrolls to top
// (detail fills the viewport since list is below the fold).
```

### Step 3.7: Rewrite `/dashboard` page

Replace `apps/web/src/app/(app)/dashboard/page.tsx` with:

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppShell } from "~/components/shell/app-shell";
import { TodayView } from "~/components/dashboard/today/today-view";
import { appRouter } from "~/server/trpc/routers/_app";
import { detectOnboardingState } from "./onboarding/detect";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DashboardPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const sp = await searchParams;
  const skipOnboarding = sp.skip === "1" || sp.skip === "true";
  const onboarding = await detectOnboardingState(userId);
  if (onboarding.firstRun && !skipOnboarding) {
    redirect("/dashboard/onboarding");
  }

  const caller = appRouter.createCaller({ userId });
  const data = await caller.producer.today();
  const selectedItemId = typeof sp.itemId === "string" ? sp.itemId : null;

  return (
    <AppShell active="today">
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <h1 className="sr-only">Today</h1>
        <TodayView data={data} selectedItemId={selectedItemId} />
      </div>
    </AppShell>
  );
}
```

### Step 3.8: Delete the old Kanban files

```bash
cd "/Users/giliasraf/Skitza 16.4"
git rm apps/web/src/app/\(app\)/dashboard/kanban.tsx
git rm apps/web/src/app/\(app\)/dashboard/kanban-helpers.ts
git rm apps/web/src/app/\(app\)/dashboard/kanban-helpers.test.ts
git rm apps/web/src/app/\(app\)/dashboard/upcoming-strip.tsx
git rm apps/web/src/app/\(app\)/dashboard/revenue-tile.tsx
```

### Step 3.9: Verify + commit

```bash
cd "/Users/giliasraf/Skitza 16.4/apps/web"
pnpm test && pnpm typecheck && pnpm lint
```

Kanban-helpers test will be gone. Full suite should still be roughly 425+ (baseline was 429, we dropped ~10 kanban tests but added ~6 today tests).

```bash
cd "/Users/giliasraf/Skitza 16.4"
git add apps/web/src/app/\(app\)/dashboard/ apps/web/src/components/dashboard/ apps/web/src/server/trpc/routers/
git commit -m "feat(dashboard): Today screen — split-inbox + KPI strip

Replaces the Kanban pipeline as the default landing. 4-KPI strip
across the top (active projects, revenue this month, sessions in
next 7 days, unresolved items). Split-inbox below: unified list of
today's actionable items (sessions / comments / invoices / leads),
sorted by urgency, with a detail pane on desktop and stack
navigation on mobile.

Kanban files deleted. Onboarding first-run redirect preserved.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Projects list — lightweight browse view

**Files:**
- Create: `apps/web/src/app/(app)/dashboard/projects/page.tsx` (currently only `[id]/page.tsx` exists)
- Create: `apps/web/src/components/dashboard/projects/projects-list.tsx`
- Reuses: existing `project.listByStage` tRPC query (from the old Kanban landing)

### Step 4.1: Write the page

Simple server component: fetches all producer projects via existing `project.listByStage()`, renders a filterable list grouped by stage with counts. Each row is a `<Link>` to `/dashboard/projects/<id>`.

```tsx
import { auth } from "@clerk/nextjs/server";
import { AppShell } from "~/components/shell/app-shell";
import { appRouter } from "~/server/trpc/routers/_app";
import { ProjectsList } from "~/components/dashboard/projects/projects-list";

type PageProps = { searchParams: Promise<{ stage?: string }> };

export default async function ProjectsPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;
  const caller = appRouter.createCaller({ userId });
  const grouped = await caller.project.listByStage();
  const sp = await searchParams;

  return (
    <AppShell active="projects">
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <h1 className="font-display text-3xl tracking-tight">Projects</h1>
        <ProjectsList grouped={grouped} activeStage={sp.stage ?? null} />
      </div>
    </AppShell>
  );
}
```

### Step 4.2: Projects list component

Client component with stage filter chips at top + rows below. Preserve the stage counts from the old Kanban.

### Step 4.3: Verify + commit

No new tests required (it's pure UI over an existing tRPC query). Full suite still green.

```bash
cd "/Users/giliasraf/Skitza 16.4"
git add apps/web/src/app/\(app\)/dashboard/projects/page.tsx apps/web/src/components/dashboard/projects/
git commit -m "feat(dashboard): Projects list — browse all projects by stage

Lightweight surface reached via 'Projects' nav item. Filters by
stage chips at the top (Lead / Booked / In Production / Final /
Paid / Archived / Payment Paused / Cancelled). Each row links to
the Project Room.

Replaces the Kanban's stage-grouped drag-drop columns with a
simpler list — the Kanban never earned the UI cost it took per the
design doc's anti-Kanban argument.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Project Room — 5-step timeline + sub-tabs shell

**Files:**
- Modify: `apps/web/src/app/(app)/dashboard/projects/[id]/page.tsx` (wrap existing detail in new shell)
- Create: `apps/web/src/components/dashboard/project/project-timeline.tsx`
- Create: `apps/web/src/components/dashboard/project/project-sub-tabs.tsx`
- Create: `apps/web/src/components/dashboard/project/project-header.tsx`

### Step 5.1: Timeline helper + test

Create `apps/web/src/components/dashboard/project/timeline-helpers.ts`:

```ts
// Maps project state → 5-step timeline view model.
// Steps: Trial → Contract → In Progress → Final → Paid
// Each step has one of 3 states: "done" | "current" | "pending"
export type TimelineStepState = "done" | "current" | "pending";
export type TimelineStep = { label: string; state: TimelineStepState };

export type ProjectTimelineInput = {
  stage: "lead" | "booked" | "contract_sent" | "in_production" | "final_review" | "paid" | "archived" | "payment_paused" | "cancelled";
  contractSigned: boolean;
  chargesCompleted: number;
  chargesTotal: number | null;
  finalDelivered: boolean;
};

export function computeTimeline(p: ProjectTimelineInput): TimelineStep[] {
  // Trial: "done" if stage !== lead
  // Contract: "done" if contractSigned
  // In Progress: "current" if deposit paid but not final delivered
  // Final: "current" when producer clicks mark final
  // Paid: "done" when all charges complete
  // ... implement per design doc
}
```

Write unit tests for every state combination (8+).

### Step 5.2: Timeline component

Client-side rendering of the computed timeline. Horizontal strip of 5 steps with connecting line. Done steps get a ✓. Current step gets a pulse animation. Pending steps are greyed.

### Step 5.3: Sub-tabs component

4-pill segmented control. Reads `?tab=` from URL. Options: `music` (default) · `sessions` · `money` · `notes`. On mobile + desktop, all 4 pills always visible (no overflow).

### Step 5.4: Project header

Composes:
- Avatar + client name + stage badge
- Payment status strip (reuse the existing `<PaymentStatusStrip>` from `apps/web/src/components/project/payment-status-strip.tsx`)
- 3-dot actions menu: Mark final delivered · Upload track · Cancel project
- 5-step timeline below

### Step 5.5: Rewrite Project Room page

Modify `apps/web/src/app/(app)/dashboard/projects/[id]/page.tsx` to render:

```tsx
<AppShell active="projects">
  <ProjectHeader project={data.project} />
  <ProjectSubTabs activeTab={tab}>
    {tab === "music"    && <MusicSubTab project={data.project} tracks={data.tracks} />}
    {tab === "sessions" && <SessionsSubTab project={data.project} />}
    {tab === "money"    && <MoneySubTab project={data.project} />}
    {tab === "notes"    && <NotesSubTab project={data.project} />}
  </ProjectSubTabs>
</AppShell>
```

Each `<FooSubTab>` is implemented in Tasks 6-8. For Task 5, stub them as placeholder divs that say "coming next."

### Step 5.6: Verify + commit

```bash
cd "/Users/giliasraf/Skitza 16.4/apps/web" && pnpm test src/components/dashboard/project
pnpm test && pnpm typecheck && pnpm lint
```

Commit:
```bash
cd "/Users/giliasraf/Skitza 16.4"
git add apps/web/src/
git commit -m "feat(project): Project Room shell — header + 5-step timeline + 4 sub-tabs

Replaces the project detail page with the new shell. Header
composes the payment status strip + 3-dot actions. Timeline
component computes 5-step state from project fields (Trial →
Contract → In Progress → Final → Paid). Sub-tabs rendered as a
4-pill segmented control driven by ?tab= URL param.

Sub-tab CONTENT is placeholder for now — Music / Sessions / Money
/ Notes get their real bodies in the next 4 tasks.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Project Room — Music sub-tab

**Files:**
- Create: `apps/web/src/components/dashboard/project/sub-tabs/music-sub-tab.tsx`
- Reuse: existing upload + waveform + comments logic from `apps/web/src/app/(app)/dashboard/projects/[id]/` if present

### Step 6.1: Salvage existing components

The current `/dashboard/projects/[id]/page.tsx` already has waveform, version switcher, and upload UI. Most of it can move into `music-sub-tab.tsx` unchanged. Audit what's there, extract it, preserve tests.

### Step 6.2: Render inside the sub-tab

The Music sub-tab is the default (empty `?tab=` → music). Drop-zone at top, then per-track sections: each track shows versions listed with play buttons, a waveform placeholder for the selected version, and a comment list below.

### Step 6.3: Commit

```bash
git add apps/web/src/components/dashboard/project/sub-tabs/music-sub-tab.tsx apps/web/src/app/\(app\)/dashboard/projects/\[id\]/
git commit -m "feat(project): Music sub-tab — tracks, versions, comments"
```

---

## Task 7: Project Room — Sessions sub-tab

**Files:**
- Create: `apps/web/src/components/dashboard/project/sub-tabs/sessions-sub-tab.tsx`
- Reuse: existing `booking.upcoming` / `booking.forProject` tRPC queries

### Step 7.1: List past + upcoming bookings

Two sections: "Upcoming" (bookings with `startsAt > now`) and "Past" (`startsAt <= now`). Each row: date · time · duration · "Reschedule" and "Cancel" buttons.

### Step 7.2: "New session" button

Opens the producer-initiated booking flow (reuses the existing booking creation form from `/dashboard/booking/`).

### Step 7.3: Commit

```bash
git add apps/web/src/components/dashboard/project/sub-tabs/sessions-sub-tab.tsx
git commit -m "feat(project): Sessions sub-tab — past + upcoming bookings"
```

---

## Task 8: Project Room — Money sub-tab

**Files:**
- Create: `apps/web/src/components/dashboard/project/sub-tabs/money-sub-tab.tsx`
- Reuse: existing contract + invoices routers

### Step 8.1: Contract section

Shows contract status (sent / signed / unsent) + signed PDF link + audit trail. If unsent, shows "Send contract" inline button that opens the existing contract template picker.

### Step 8.2: Invoices section

Table of invoices: date · kind · amount · status · Stripe link. Reuses data from existing `invoices` table scoped to this project.

### Step 8.3: Commit

```bash
git add apps/web/src/components/dashboard/project/sub-tabs/money-sub-tab.tsx
git commit -m "feat(project): Money sub-tab — contract + invoices ledger

Merges the old Contracts + Invoices top-level pages into one
project-scoped view. Contract appears first (send-on-demand or
signed-PDF view), invoices ledger below (status, amounts, Stripe
links)."
```

---

## Task 9: Project Room — Notes sub-tab

**Files:**
- Create: `apps/web/src/components/dashboard/project/sub-tabs/notes-sub-tab.tsx`
- Possibly: `apps/web/src/server/trpc/routers/project.ts` — add `updateNotes` mutation if it doesn't exist
- Schema: check if `projects.producerNotes` column exists; if not, skip persistence for this refactor and stub as "coming soon"

### Step 9.1: Check schema

```bash
grep -n "producerNotes\|notes" packages/db/src/schema.ts | head
```

If column exists, wire through. If not, the Notes sub-tab renders a read-only placeholder for now + TODO comment. No migration in this refactor.

### Step 9.2: Commit

```bash
git add apps/web/src/components/dashboard/project/sub-tabs/notes-sub-tab.tsx
git commit -m "feat(project): Notes sub-tab"
```

---

## Task 10: Music top-level — cross-project library

**Files:**
- Create: `apps/web/src/app/(app)/dashboard/music/page.tsx`
- Create: `apps/web/src/components/dashboard/music/music-library.tsx`
- Modify: `apps/web/src/server/trpc/routers/producer.ts` — add `producer.music.list` query
- Test: `apps/web/src/server/trpc/routers/__tests__/producer-music.test.ts`

### Step 10.1: TDD the query

```ts
// producer.music.list returns:
{
  tracks: Array<{
    id: string;            // track_version id
    trackTitle: string;
    label: string;
    projectId: string;
    projectTitle: string;
    clientName: string;
    uploadedAt: Date;
    audioUrl: string | null;
  }>;  // max 100, sorted by uploadedAt desc
}
```

Tests: empty case, sort order, auth scoping (WHERE by producerId).

### Step 10.2: Implement + wire page

Cross-project library list. Tap row → navigates to `/dashboard/projects/<projectId>?tab=music&version=<versionId>`.

### Step 10.3: Delete old `/dashboard/library`

Already done in Task 2's file deletions (library → redirect to /dashboard/music). Just confirm the redirect now lands on the new Music page.

### Step 10.4: Commit

```bash
git add apps/web/src/app/\(app\)/dashboard/music/ apps/web/src/components/dashboard/music/ apps/web/src/server/trpc/routers/
git commit -m "feat(dashboard): Music — cross-project library

Samply-vibe screen listing every track across every project sorted
by most recent upload. Tap a row → deep-links to that track inside
its Project Room's Music sub-tab.

Replaces the killed /dashboard/library page."
```

---

## Task 11: Setup — merge Settings + Portfolio + Booking (availability)

**Files:**
- Modify: `apps/web/src/app/(app)/dashboard/settings/page.tsx` — becomes the Setup screen
- Salvage: content from deleted `/dashboard/portfolio`, `/dashboard/booking` (availability)
- Test: lightweight smoke test that the sections render

### Step 11.1: Section layout

Accordion or card layout with sections:
- Services catalog (already in settings — preserved)
- Availability (moved from `/dashboard/booking/`)
- Portfolio (moved from `/dashboard/portfolio/`)
- Connections (Stripe + Calendar)
- Account

Use `?section=` search param to deep-link directly to a section (matches the redirects from Task 2).

### Step 11.2: Move portfolio + availability components into Setup

Preserve their test files in their new location.

### Step 11.3: Commit

```bash
git add apps/web/src/app/\(app\)/dashboard/settings/ apps/web/src/app/\(app\)/dashboard/booking/
git rm -rf apps/web/src/app/\(app\)/dashboard/booking
git commit -m "feat(dashboard): Setup — merge Settings + Portfolio + Availability

Setup absorbs the old /dashboard/portfolio and /dashboard/booking
(availability config) routes into accordion sections. ?section=
search param deep-links to a specific section, wired up to match
the redirects from Task 2."
```

---

## Task 12: Rewire command palette + keyboard shortcuts

**Files:**
- Modify: `apps/web/src/components/shell/command-palette.tsx`
- Modify: `apps/web/src/components/shell/shortcuts-bridge.tsx`

### Step 12.1: Audit current commands

Open `command-palette.tsx`. List every command it currently surfaces. Drop commands that pointed to killed routes (Pipeline, Leads, Contracts, Invoices, Inbox, Library, Portfolio, Clients, Bookings).

### Step 12.2: Add new commands

- "Go to Today" → `/dashboard`
- "Go to Music" → `/dashboard/music`
- "Go to Projects" → `/dashboard/projects`
- "Go to Setup" → `/dashboard/settings`
- "Search client" — fuzzy over client_contacts
- "Search project" — fuzzy over projects

### Step 12.3: Rewire keyboard shortcuts

In `shortcuts-bridge.tsx`:
- `G T` → Today
- `G M` → Music
- `G P` → Projects
- `G S` → Setup
- Remove old shortcuts pointing to killed routes

### Step 12.4: Commit

```bash
git add apps/web/src/components/shell/
git commit -m "refactor(shell): rewire command palette + keyboard shortcuts for 4-screen nav

Commands pointing to killed routes removed. New Go-to-<tab>
commands + shortcuts (G T / G M / G P / G S). Client + project
search preserved as fuzzy matchers so ⌘K → type 'Dan' still jumps
to Dan's Project Room even though the Clients directory is gone."
```

---

## Task 13: Notification bell — extract from old Inbox

**Files:**
- Create: `apps/web/src/components/shell/notification-bell.tsx`
- Modify: `apps/web/src/components/shell/app-shell.tsx` (mount bell in header)

### Step 13.1: Salvage inbox logic

The old `/dashboard/inbox` had its own rendering of unread notifications. Extract the data-fetching side + render as a bell-icon dropdown in the AppShell header.

### Step 13.2: Inline dropdown

Click bell → dropdown with unread items; click any → deep-link to its Project Room (mark-as-read on click). "Mark all read" at bottom. "Settings" link → Setup > Notifications.

### Step 13.3: Commit

```bash
git add apps/web/src/components/shell/
git commit -m "feat(shell): notification bell — replaces old Inbox page"
```

---

## Task 14: Empty states + accessibility pass

**Files:**
- Modify: Today view, Project Room (each sub-tab), Music, Setup
- Add empty-state components as needed

### Step 14.1: Add empty states per design doc

- Today (all caught up) → "All caught up. Next session tomorrow at 14:00."
- Music (no tracks) → full-area drop zone with "Drop a WAV to kick things off."
- Project Room (no tracks in a new project) → per-timeline-step inline CTA
- Setup (unconfigured) → 3-item checklist

### Step 14.2: Accessibility audit

- `aria-current` on active nav item
- `aria-live="polite"` on notification bell + Today list (new items announced)
- Focus trap on modals (cancel, edit, confirm charge — already built earlier; verify still works)
- `sr-only` h1 on each screen for skip-to-content navigation
- `Esc` closes every modal/dropdown

### Step 14.3: Commit

```bash
git add apps/web/src/
git commit -m "feat(dashboard): empty states + a11y pass

Each of the 4 screens gets a thoughtful empty state (per design
doc): Today's 'all caught up', Music's full-area drop zone,
Project Room's per-step CTA, Setup's checklist. ARIA live regions,
focus traps, and Esc-to-close uniformly wired."
```

---

## Push branch + open PR

After Task 14:

```bash
cd "/Users/giliasraf/Skitza 16.4"
git push -u origin feat/producer-dashboard-4-screens
gh pr create --title "refactor: producer dashboard 4-screen consolidation" --body "$(cat <<'EOF'
## Summary

Collapses 10 top-level dashboard nav items into 4 screens + a global command layer, matching the Linear / Stripe Dashboard design philosophy. Pure UI refactor — no schema changes, no new tRPC procedures.

Design: `docs/plans/2026-04-19-producer-dashboard-4-screens-design.md`
Plan: `docs/plans/2026-04-19-producer-dashboard-4-screens.md`

### 4 screens
- **Today** — split-inbox + 4-KPI strip + saved-view dropdown
- **Project Room** — 5-step timeline + 4 sub-tabs (Music / Sessions / Money / Notes)
- **Music** — cross-project library
- **Setup** — services / availability / portfolio / connections

### Kill list (9 routes → 301/302)
pipeline · clients · leads · bookings · contracts · invoices · inbox · library · portfolio

### Test plan (Task 15 — your QA)
- [ ] Sign in → land on Today, see 4-KPI strip + list
- [ ] Click an item → detail pane populates (desktop) / navigates (mobile)
- [ ] Click a project from Projects list → Project Room loads
- [ ] Switch between 4 sub-tabs inside Project Room — all render
- [ ] ⌘K → type client name → jump to their Project Room
- [ ] Keyboard shortcut G M → Music loads
- [ ] Hit a legacy URL (/dashboard/contracts) → 301 redirects to /dashboard
- [ ] Mobile (360px) — bottom nav has 4 tabs, no hamburger
EOF
)"
```

---

## Task 15 (awaits user): Manual QA + merge

Walk the checklist in the PR body. Merge when green.

---

## Success criteria

When this plan is complete:

- [ ] Sidebar shows exactly 4 items: Today · Music · Projects · Setup
- [ ] All 9 killed routes 301/302-redirect correctly
- [ ] Today landing renders list + detail on desktop, list-only on mobile
- [ ] Project Room has 5-step timeline + 4 sub-tabs + payment status strip
- [ ] Music shows all tracks across all projects sorted by upload date
- [ ] Setup aggregates portfolio + availability + services + connections
- [ ] ⌘K reaches all 4 screens + fuzzy-search clients/projects
- [ ] Keyboard shortcuts G T / G M / G P / G S work
- [ ] Notification bell appears in header, dropdown shows unread
- [ ] Full test suite (429+ baseline, target ~435 after adds/removes) green
- [ ] Typecheck + lint clean
