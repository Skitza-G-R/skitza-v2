# Skitza Phase 1 — Weeks 3–5 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute task-by-task. Each task gets a fresh implementer subagent + spec compliance review + code quality review.

**Goal:** Turn the bare auth shell from weeks 1–2 into something a producer can actually fill out and share — Producer onboarding, public Portfolio, and a working Magic Lead Link with view tracking. Public booking (Cal.com Atoms) is in scope but blocked on credentials, executed after the AFK-safe slice.

**Architecture:** New schema entities (`Lead`, `MagicLink`, `MagicLinkView`, `PortfolioTrack`) extending `packages/db`. Server Actions for the producer-facing onboarding form (Clerk-protected). Public routes under `apps/web/src/app/(public)/p/[slug]` (portfolio) and `/m/[token]` (magic-link landing). Reuses the HMAC token primitive from Task 9. No waveform yet — the public portfolio shows track metadata + a basic `<audio>` tag; wavesurfer.js lands in weeks 6–8 alongside the Project Room.

**Tech Stack (no new top-level deps):** Drizzle 0.36, tRPC v11, Next.js 15 Server Actions, zod for input validation, Clerk for the producer-side gate, the existing magic-link HMAC module. Cal.com Atoms (Task K) and Resend (Task L) add deps but are credential-blocked.

**Reference:** `2026-04-16-skitza-design.md` §2 features 1, 6, 7, 10 + §4 Phase 1 Weeks 3–5.

---

## Prerequisites

Already in place from weeks 1–2:
- Producer table + `createDb` + workspace `@skitza/db`
- Clerk auth (middleware, sign-in/up, `currentUser()`)
- tRPC v11 root + `health.check`
- Magic-link HMAC issuer/verifier (Task 9)
- Tailwind v4 themes (`chrome-dark`, `room-paper`)

User-blocked (mark tasks K/L pending until set):
- **Cal.com account** → API key + booking event types (Task K)
- **Resend account** → API key + verified sending domain (Task L)

---

## Task Map

| # | Task | Blocked? | TDD? | Notes |
|---|------|----------|------|-------|
| A | Schema: `leads`, `magic_links`, `magic_link_views`, `portfolio_tracks` + migration | — | TDD (DB integration) | Foundation for B–J |
| B | Producer onboarding form + Server Action (slug + display name + currency + timezone) | — | TDD (action pure logic) | Reads/writes existing Producer row from Task 8 webhook |
| C | Onboarding gate in `clerkMiddleware`: redirect `/dashboard` → `/onboarding` until profile complete | — | TDD (matcher + flag) | Producer is "complete" when `displayName` set AND `slug` not the email-derived default |
| D | `portfolio.*` tRPC router: list/create/update/delete/reorder | — | TDD (router unit + zod) | Producer-scoped; uses Clerk userId → Producer.id lookup |
| E | Producer dashboard "Portfolio" tab — basic CRUD UI | — | RTL + interaction | shadcn `<Card>` list, drag-to-reorder = phase-2 |
| F | Public `/p/[slug]` — server component, dark theme, native `<audio>` (no waveform yet) | — | RSC + Playwright smoke | Falls through to 404 if slug unknown |
| G | `magicLink.*` tRPC router: issue (producer-scoped) + revoke + list | — | TDD (router) | Wraps Task 9's `issueMagicToken` with DB persistence |
| H | Public `/m/[token]` landing — verify token, log `magic_link_views` row, redirect to target | — | TDD (route handler) | Captures IP, UA, referer; resolves to portfolio for v1 (booking lands in Task K) |
| I | Producer dashboard "Lead Links" tab — issue links, see analytics (opens, last-open, dwell) | — | RTL + interaction | Reads aggregated `magic_link_views` |
| J | Magic-link analytics aggregation tRPC procedure (counts + dwell percentile) | — | TDD (pure SQL test) | Backs Task I |
| K | **BLOCKED:** Cal.com Atoms public booking page `/book/[slug]` | Cal.com key | scaffold + smoke | Producer picks event type → embedded booking widget |
| L | **BLOCKED:** Send magic-link via Resend (button on Lead Links tab) | Resend key | TDD (transport mock) | Email template + dispatch |

---

## Task A — Schema additions: leads, magic_links, magic_link_views, portfolio_tracks

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/0001_*.sql` (drizzle-kit generated)
- Modify: `packages/db/src/__tests__/producer.test.ts` (rename or add a sibling for new tables)

**Step 1 — schema additions**

```typescript
// Append to schema.ts after the producers table:

export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  source: text("source"), // free-text for v1: "instagram dm", "referral from X", etc.
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;

export const portfolioTracks = pgTable("portfolio_tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  artist: text("artist"),                 // optional credit line
  audioUrl: text("audio_url").notNull(),  // for v1, an external URL (Spotify CDN, R2 later)
  artworkUrl: text("artwork_url"),
  position: integer("position").notNull().default(0), // for ordering
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PortfolioTrack = typeof portfolioTracks.$inferSelect;
export type NewPortfolioTrack = typeof portfolioTracks.$inferInsert;

export const magicLinks = pgTable("magic_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  producerId: uuid("producer_id").notNull().references(() => producers.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  target: text("target").notNull(),     // "portfolio" | "booking" | "project:<uuid>" — string-typed for forward compat
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 of the issued token; never store the token itself
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type MagicLink = typeof magicLinks.$inferSelect;
export type NewMagicLink = typeof magicLinks.$inferInsert;

export const magicLinkViews = pgTable("magic_link_views", {
  id: uuid("id").defaultRandom().primaryKey(),
  magicLinkId: uuid("magic_link_id").notNull().references(() => magicLinks.id, { onDelete: "cascade" }),
  ip: text("ip"),               // captured from x-forwarded-for; nullable for tests
  userAgent: text("user_agent"),
  referer: text("referer"),
  dwellMs: integer("dwell_ms"), // populated by client-side beacon on unload; nullable
  viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
});
export type MagicLinkView = typeof magicLinkViews.$inferSelect;
export type NewMagicLinkView = typeof magicLinkViews.$inferInsert;
```

Add `integer` to the existing `pg-core` import.

**Step 2 — generate migration**

```
DATABASE_URL=$(grep ^DATABASE_URL apps/web/.env.local | cut -d= -f2-) corepack pnpm --filter @skitza/db db:generate
```

Expected: a new file `packages/db/drizzle/0001_*.sql` with `CREATE TABLE` for all four. Inspect for `REFERENCES` clauses and `ON DELETE CASCADE` correctness.

**Step 3 — apply migration**

```
DATABASE_URL=$(grep ^DATABASE_URL apps/web/.env.local | cut -d= -f2-) corepack pnpm --filter @skitza/db db:migrate
```

**Step 4 — integration test**

Create `packages/db/src/__tests__/extended-tables.test.ts` mirroring `producer.test.ts`:
- Insert a producer + lead + magic_link + magic_link_view + portfolio_track
- Verify FK cascade: deleting the producer removes the lead, magic_link, magic_link_view, portfolio_track
- Verify `magicLinks.tokenHash` UNIQUE constraint

Skip the suite when `DATABASE_URL_TEST` unset (same pattern as producer test).

**Step 5 — commit**

```
git add packages/db/
git commit -m "feat(db): add leads, magic_links, magic_link_views, portfolio_tracks tables"
```

---

## Task B — Producer onboarding form + Server Action

**Files:**
- Create: `apps/web/src/app/(app)/onboarding/page.tsx`
- Create: `apps/web/src/app/(app)/onboarding/actions.ts` ("use server")
- Create: `apps/web/src/app/(app)/onboarding/__tests__/actions.test.ts`
- Modify: `apps/web/src/lib/slug.ts` (export an `isAutoSlug(slug, email)` helper)

**Step 1 — Server Action contract**

```typescript
// actions.ts
"use server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { createDb, producers } from "@skitza/db";

const Input = z.object({
  displayName: z.string().min(1).max(80),
  slug: z.string().min(3).max(48).regex(/^[a-z0-9-]+$/),
  defaultCurrency: z.enum(["USD", "EUR", "GBP", "ILS"]),
  timezone: z.string().min(1).max(64),
});

export async function completeOnboarding(input: z.infer<typeof Input>) {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const parsed = Input.parse(input);
  const db = createDb(dbUrl);
  await db.update(producers).set(parsed).where(eq(producers.clerkUserId, userId));
}
```

**Step 2 — UI**

`page.tsx` is a client component (`"use client"`) with a shadcn `<Card>` and a form. On submit, calls `completeOnboarding(...)` and routes to `/dashboard` on success. Use `useTransition` for the server-action pending state.

**Step 3 — test the action's input validation**

Mock `auth()` and `createDb` (same pattern as the webhook test). Cases:
- valid input → `db.update` called with parsed values
- bad slug (uppercase) → `ZodError`
- unauthorized → throws "unauthorized"
- missing env → throws "missing DATABASE_URL"

**Step 4 — verify gates**

```
corepack pnpm --filter web typecheck && lint && test --run && build
```

**Step 5 — commit**

---

## Task C — Onboarding gate middleware

**Files:**
- Modify: `apps/web/src/middleware.ts`
- Create: `apps/web/src/middleware.test.ts` (optional — can be deferred to e2e)

**Step 1 — extend matcher**

Add a Clerk-protected check that, after auth, looks up the producer's profile completion. The gate must be cheap (single DB read), so cache it in the middleware response cookie for 5 min:

```typescript
const isProtected = createRouteMatcher(["/dashboard(.*)", "/projects(.*)", "/settings(.*)"]);
const isOnboarding = createRouteMatcher(["/onboarding"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isProtected(req.nextUrl.pathname)) return;
  const { userId } = await auth.protect();

  // Skip the DB hit if the cookie says we already onboarded recently
  if (req.cookies.get("skitza_onboarded")?.value === "1") return;
  if (isOnboarding(req.nextUrl.pathname)) return;

  // DB lookup. If displayName is null OR slug looks auto-generated, redirect.
  // Keep this query in middleware OR move to a server-rendered redirect in
  // /dashboard/layout.tsx — RSC layout is simpler, less middleware risk.
});
```

**Decision point:** middleware DB calls are heavyweight on Vercel (cold-start lambda per req). Prefer a `dashboard/layout.tsx` server-side redirect using `currentUser()` + a Producer fetch. Switch the task to that approach during implementation if the middleware feels heavy — implementer may use judgement here.

**Step 2 — test by visiting /dashboard with an incomplete producer (e2e)**

For now, manual test via the live app. Automated middleware tests can wait.

**Step 3 — commit**

---

## Task D — `portfolio.*` tRPC router

**Files:**
- Create: `apps/web/src/server/trpc/routers/portfolio.ts`
- Modify: `apps/web/src/server/trpc/routers/_app.ts` (mount the router)
- Create: `apps/web/src/server/trpc/routers/__tests__/portfolio.test.ts`

**Procedures:**
- `list` (query) — returns producer's tracks, ordered by `position`
- `create` (mutation) — `{ title, artist?, audioUrl, artworkUrl?, position? }` → returns inserted row
- `update` (mutation) — `{ id, ...fields }` → updates if `producerId` matches caller
- `delete` (mutation) — `{ id }` → deletes if `producerId` matches caller
- `reorder` (mutation) — `{ orderedIds: string[] }` → updates `position` in a single transaction

All procedures require Clerk auth; resolve `Producer.id` from the Clerk userId at the start of each call (consider extracting a `producerProcedure` middleware).

**Test pattern:** mock `createDb` per existing webhook test; assert insert/update/delete called with right args; assert authorization (mismatch producerId → throws).

---

## Task E — Producer dashboard "Portfolio" tab

**Files:**
- Create: `apps/web/src/app/(app)/dashboard/portfolio/page.tsx`
- Create: `apps/web/src/app/(app)/dashboard/portfolio/track-form.tsx`
- Create: `apps/web/src/app/(app)/dashboard/portfolio/__tests__/track-form.test.tsx` (RTL)

UI: list of `<Card>`s (one per track), "Add track" button opens a dialog with title/artist/audioUrl/artworkUrl inputs. Use tRPC client (`api.portfolio.list.useQuery()` etc.). Optimistic updates not required for v1.

Drag-to-reorder is **deferred** — show a placeholder badge "Reorder coming soon".

---

## Task F — Public `/p/[slug]` portfolio page

**Files:**
- Create: `apps/web/src/app/(public)/p/[slug]/page.tsx` (server component)
- Create: `apps/web/src/app/(public)/p/[slug]/__tests__/page.test.tsx` (RTL with mocked DB)
- Create: `apps/web/src/app/(public)/layout.tsx` (sets the dark `chrome-dark` theme class on `<body>`)

**Behavior:**
- Server component fetches `producers` row by slug + their `portfolioTracks` ordered by position
- Returns `notFound()` if slug unknown
- Renders producer's `displayName` + brand accent (CSS vars from Task 10 resolver) + a list of tracks with `<audio controls>` (waveform comes in weeks 6–8)
- `metadata` export for OG: `<title>{displayName} — Portfolio</title>` + producer brand image as og:image (fallback to default)

**Step — smoke check after deploy:**
```
curl -sS https://skitza-v2-web.vercel.app/p/<seeded-slug> | grep -o '<title>[^<]*</title>'
```

---

## Task G — `magicLink.*` tRPC router

**Files:**
- Create: `apps/web/src/server/trpc/routers/magic-link.ts`
- Modify: `apps/web/src/server/trpc/routers/_app.ts`
- Create: `apps/web/src/server/trpc/routers/__tests__/magic-link.test.ts`

**Procedures:**
- `issue` (mutation) — `{ leadId?: string; target: "portfolio" | "booking"; ttlHours: number }` → returns the full URL (`/m/<token>`) and the persisted `magicLinks` row (sans token). Implementation:
  1. Call `issueMagicToken({ producerId, target, ttlSeconds: ttlHours * 3600, context: { leadId } })`
  2. Hash the token (`crypto.createHash("sha256")`) → store `tokenHash` + `expiresAt` in `magic_links`
  3. Return `{ url: ${SITE_URL}/m/${token}, link }`
- `list` (query) — producer's links, joined with the latest view timestamp
- `revoke` (mutation) — `{ id }` → set `revokedAt = now()`

---

## Task H — Public `/m/[token]` landing

**Files:**
- Create: `apps/web/src/app/(public)/m/[token]/route.ts` (Route Handler — uses GET because it's a link)
- Create: `apps/web/src/app/(public)/m/[token]/__tests__/route.test.ts`

**Behavior:**
1. Verify token via `verifyMagicToken(token)` — on `MagicTokenInvalid`, return `404`
2. Hash the token, look up `magic_links` row by `tokenHash`. Reject if `revokedAt != null` or `expiresAt < now()`.
3. Insert a `magic_link_views` row with `ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()`, `userAgent = req.headers["user-agent"]`, `referer = req.headers["referer"]`
4. 302 redirect to the target's actual URL:
   - `target == "portfolio"` → `/p/<producer.slug>?via=<magicLinkId>`
   - `target == "booking"` → `/book/<producer.slug>?via=<magicLinkId>` (Task K)

The `?via=` query param is read by a tiny client-side beacon on the destination page that POSTs `{ viewId, dwellMs }` back when the user navigates away — that updates `magic_link_views.dwellMs`. The beacon endpoint can ship as **Task H.5** if time permits.

---

## Task I — Dashboard "Lead Links" tab

**Files:**
- Create: `apps/web/src/app/(app)/dashboard/leads/page.tsx`
- Create: `apps/web/src/app/(app)/dashboard/leads/__tests__/page.test.tsx` (RTL)

UI: table of issued links with columns: Created, Target, Lead (if attached), Opens, Last Opened, Dwell (median), Status (active/expired/revoked), Actions (copy URL, revoke).

Uses `api.magicLink.list.useQuery()` + Task J's analytics procedure.

---

## Task J — Magic-link analytics aggregation

**Files:**
- Modify: `apps/web/src/server/trpc/routers/magic-link.ts` (add `analytics` procedure)
- Modify: tests

Single SQL with `LEFT JOIN magic_link_views` + `COUNT()` + `MAX(viewed_at)` + `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dwell_ms)`. Group by `magic_links.id`. Filter to caller's producer.

---

## Task K — **BLOCKED: Cal.com Atoms public booking page**

**Blocker:** Cal.com OAuth client + API key (free tier exists; user must create at https://cal.com)

When unblocked:
- `pnpm add @calcom/atoms` in `apps/web`
- New page: `apps/web/src/app/(public)/book/[slug]/page.tsx`
- Embed `<Booker />` with the producer's Cal.com username (stored on `producers.calComUsername` — schema migration B+1 needed)
- Webhook endpoint at `/api/webhooks/cal` to persist a `Booking` row when an event is scheduled

Defer the schema additions for `bookings` table to whenever Task K starts.

---

## Task L — **BLOCKED: Send magic-link via Resend**

**Blocker:** Resend account + API key + verified domain (or use `onboarding@resend.dev` for testing)

When unblocked:
- `pnpm add resend`
- `apps/web/src/lib/email/resend.ts` — typed wrapper around `resend.emails.send`
- "Send to lead" button on the Lead Links tab (Task I) opens a dialog: lead's email + an editable subject/body template
- The button calls a new tRPC mutation `magicLink.email({ id, to, subject, body })` that issues a fresh URL and dispatches the email
- Email template: simple HTML, producer brand colors via inline styles, single CTA button to the magic-link URL

---

## Verification at end of weeks 3–5

End-to-end manual scenario (works in a real browser, not curl):

1. Producer signs up → onboarding form → fills slug `test-producer` + display name → lands on `/dashboard`
2. Adds 2 portfolio tracks via dashboard
3. Visits `/p/test-producer` (signed out, in incognito) → sees their two tracks playing in the dark theme
4. Back in dashboard, issues a magic link → copies URL → opens in incognito → redirected to `/p/test-producer?via=<viewId>`
5. Returns to dashboard → "Lead Links" tab shows: 1 open, last opened just now, dwell pending

(Tasks K + L extend this with: 6. Producer fills Cal.com username → public `/book/test-producer` works; 7. Producer emails the link to a real lead via Resend.)

---

## Execution mode

Following `superpowers:subagent-driven-development`:
- Tasks A → J executed in order, fresh implementer subagent per task
- Spec compliance review + code quality review after each
- Inline polish for small fixes (1-2 lines) by the controller
- Tasks K and L start when user unblocks credentials

Estimated total: 10–12 hours of subagent work for A–J. The unblocked AFK slice (A, B, C, D, F, H) is ~5–6 hours.
