# Skitza Artist App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the signed-in artist-facing app — a Spotify-style 4-tab surface (Home / Music / Book / Store) with a persistent mini-player, Studio Switcher in the header, and seamless coexistence with the existing magic-link flow.

**Architecture:** Same Clerk instance for producers + artists; role detected from DB lookup post-sign-in. New `/artist/*` route group under `apps/web/src/app/`. Identity bridges across producers via a single `client_contacts.clerk_user_id` column stamped by the Clerk `user.created` webhook on first sign-in. Audio state lives in a React Context at the layout level so tab navigation never remounts the `<audio>` element.

**Tech Stack:** Next.js 15 App Router (RSC + Server Actions), tRPC v11, Drizzle ORM + Neon Postgres, Clerk v7, wavesurfer.js v7, Tailwind v4, Vitest. Reuses everything from the auto-installments build (the Stripe plan picker, contracts, payment status strip, Customer Portal deep-link).

**Design doc:** `docs/plans/2026-04-19-artist-app-design.md` — read before starting for full rationale.

---

## Prerequisites

Before Task 1, the engineer should:

1. Read the design doc above. Every "why" question has its answer there.
2. Be able to run `pnpm install`, `pnpm test`, `pnpm typecheck`, `pnpm lint` from `apps/web/` and get green output (322 tests passing on `main` baseline as of this writing).
3. Have access to the prod Neon DB via `vercel env pull --environment=production` (matches the pattern from the auto-installments migrations).
4. Skim `apps/web/src/components/shell/app-shell.tsx` (the producer dashboard shell) to know what visual patterns + design tokens to mirror for the artist shell.
5. Know that Clerk sign-in lives at `/sign-in` and is shared between producers and artists — role is determined server-side by DB lookup, not by Clerk metadata.

### Project conventions

- **Tests live beside code**: `foo.ts` → `foo.test.ts` in the same directory, OR `__tests__/foo.test.ts` if there are many. Follow whatever the surrounding files do.
- **tRPC procedures**: producer-scoped routers use `producerProcedure` from `~/server/trpc/producer-procedure`. This task introduces a parallel `artistProcedure` for artist-scoped queries.
- **Drizzle migrations**: each migration is a SQL file in `packages/db/drizzle/NNNN_<name>.sql`. Latest applied migration is `0023_projects_currency.sql` — this plan's first migration is `0024`.
- **Money**: always integer cents (`amount_cents`). Currency is ISO 4217 uppercase in DB, lowercase when passed to Stripe.
- **Idempotency**: every webhook handler must be safe to replay. Use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` for inserts; UPDATEs are inherently idempotent.
- **No new dependencies**: reuse existing libraries unless a task explicitly approves a new one.
- **CSS variables, not hex codes**: `rgb(var(--brand-primary))`, `rgb(var(--bg-elevated))`, `rgb(var(--fg-secondary))`, `rgb(var(--border-subtle))`. The brand can be re-themed by changing CSS vars; hex codes break that.
- **Mobile-first**: all new components must look right at 360px wide before they're tested at 1280px.

---

## Task 1: Schema migration — add `client_contacts.clerk_user_id`

**Files:**
- Create: `packages/db/drizzle/0024_client_contacts_clerk_user.sql`
- Modify: `packages/db/src/schema.ts` (append `clerkUserId` column to `clientContacts` + a partial index)

### Step 1.1: Write the migration SQL

Create `packages/db/drizzle/0024_client_contacts_clerk_user.sql`:

```sql
-- Artist app — bridge `client_contacts` rows to a global Clerk user
-- identity. When an artist signs in for the first time, the Clerk
-- `user.created` webhook stamps their Clerk user id onto every
-- existing client_contacts row matching their email_hash. After
-- that, "all studios for this artist" is a single SELECT against
-- (clerk_user_id) — no email-hash join needed.
--
-- Nullable so existing rows (and every magic-link upsert path that
-- runs before the artist signs in) keep working unchanged.
--
-- Partial index: only the rows we actually query by clerk_user_id
-- get indexed, keeping the index small until artist sign-ups ramp.
BEGIN;

ALTER TABLE "client_contacts"
  ADD COLUMN IF NOT EXISTS "clerk_user_id" text;

CREATE INDEX IF NOT EXISTS "client_contacts_clerk_user_idx"
  ON "client_contacts" ("clerk_user_id")
  WHERE "clerk_user_id" IS NOT NULL;

COMMIT;
```

### Step 1.2: Update `packages/db/src/schema.ts`

Find the `clientContacts` table definition (around line 540). Add the new column right after `lastSeenAt` (or after the existing Phase H.2 fields, wherever fits naturally):

```ts
// Stamped by the Clerk user.created webhook on first artist sign-in.
// Null = client has never signed in (still uses magic links). Once
// stamped, the artist app can resolve all studios for this person via
// a single index lookup on (clerkUserId).
clerkUserId: text("clerk_user_id"),
```

Then update the table's third-arg config object to include the partial index. Look for the existing pattern (other tables use `index("...").on(t.foo).where(...)`) — add:

```ts
clerkUserIdx: index("client_contacts_clerk_user_idx")
  .on(t.clerkUserId)
  .where(sql`${t.clerkUserId} IS NOT NULL`),
```

`sql` is already imported elsewhere in this file. `index` should already be imported. Add `uniqueIndex`/`index` to the imports if not already present.

### Step 1.3: Typecheck

Run: `cd "/Users/giliasraf/Skitza 16.4" && pnpm --filter @skitza/db typecheck`

Expected: clean (no output, exit 0).

### Step 1.4: Apply migration to production

Use the same pattern as the auto-installments migrations (apply directly via Neon serverless from a Node script, NOT a naive split-by-semicolon).

```bash
cd "/Users/giliasraf/Skitza 16.4/apps/web"
pnpm vercel env pull .env.mig --environment=production --yes
set -a && source .env.mig && set +a
cd /Users/giliasraf/Skitza\ 16.4/node_modules/.pnpm/node_modules
node -e "
const { Pool } = require('@neondatabase/serverless');
const fs = require('fs');
const sql = fs.readFileSync('/Users/giliasraf/Skitza 16.4/packages/db/drizzle/0024_client_contacts_clerk_user.sql', 'utf8');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  await p.query(sql);
  const cols = await p.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='client_contacts' AND column_name='clerk_user_id'\");
  console.log('Column present:', cols.rows.length === 1);
  const idx = await p.query(\"SELECT indexname FROM pg_indexes WHERE tablename='client_contacts' AND indexname='client_contacts_clerk_user_idx'\");
  console.log('Index present:', idx.rows.length === 1);
  await p.end();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
"
rm -f /Users/giliasraf/Skitza\ 16.4/apps/web/.env.mig
```

Expected: both "present: true" lines.

### Step 1.5: Commit

```bash
cd "/Users/giliasraf/Skitza 16.4"
git checkout -b feat/artist-app
git add packages/db/drizzle/0024_client_contacts_clerk_user.sql packages/db/src/schema.ts
git commit -m "$(cat <<'EOF'
feat(db): client_contacts.clerk_user_id for artist app

Adds nullable clerk_user_id column + partial index. Stamped by
Clerk user.created webhook on first artist sign-in (next task).
Existing magic-link rows stay unchanged — the column is purely
additive.

Migration 0024 applied to prod.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Clerk webhook handler — stamp existing rows on first sign-in

**Files:**
- Modify: `apps/web/src/app/api/webhooks/clerk/route.ts` (extend `user.created` handler with the artist-stamping branch)
- Test: `apps/web/src/app/api/webhooks/clerk/route.test.ts` (extend existing or create)

### Step 2.1: Write the failing test

Open the existing route test file (or create one if missing). Add a new `describe` block:

```ts
describe("user.created — artist stamping", () => {
  it("stamps clerk_user_id on every client_contacts row matching the email_hash", async () => {
    // Setup: insert 2 client_contacts rows for different producers
    // with the same email "dan@example.com" (sha256 hashed).
    // Fire user.created webhook with that email.
    // Assert: both rows now have clerk_user_id set to the user.id.
  });

  it("leaves rows that already have a clerk_user_id alone (idempotent on re-fire)", async () => {
    // Setup: row with clerk_user_id = "user_existing"
    // Fire user.created webhook for "user_new" with the same email
    // Assert: row's clerk_user_id is still "user_existing" (no overwrite).
  });

  it("creates the producers row AND stamps any client_contacts rows in one webhook (producer-also-client edge case)", async () => {
    // Setup: insert a client_contacts row for producer A with email "gili@studios.test"
    // Fire user.created webhook for that email
    // Assert: producers row exists with clerk_user_id set + client_contacts row also stamped
  });

  it("does nothing when no client_contacts rows match the email_hash", async () => {
    // Setup: no rows
    // Fire webhook
    // Assert: no error, returns 200, no rows mutated
  });
});
```

The mock DB pattern from `apps/web/src/server/stripe/customer.test.ts` is a good reference — same shape, mocked Drizzle chain.

### Step 2.2: Run test to verify it fails

Run: `cd "/Users/giliasraf/Skitza 16.4/apps/web" && pnpm test src/app/api/webhooks/clerk/route.test.ts`

Expected: FAIL with assertions like "expected `clerk_user_id` to be 'user_xxx', got `undefined`" or similar.

### Step 2.3: Implement the artist-stamping branch

Modify `apps/web/src/app/api/webhooks/clerk/route.ts`. Find the `user.created` block. Add the stamping logic after the `producers.insert(...)` call:

```ts
import { createDb, producers, clientContacts, eq, and, isNull } from "@skitza/db";
import { createHash } from "node:crypto";
// ... existing imports

if (evt.type === "user.created") {
  const id = evt.data?.id;
  const email = evt.data?.email_addresses?.[0]?.email_address;
  if (!id || !email) return new Response("invalid payload", { status: 400 });

  const db = createDb(dbUrl);

  // Existing: insert producer row (idempotent via onConflictDoNothing)
  await db.insert(producers).values({
    clerkUserId: id,
    email,
    displayName: evt.data?.first_name ?? null,
    slug: emailToSlug(email),
  }).onConflictDoNothing().returning();

  // NEW: stamp existing client_contacts rows that match this email.
  // The IS NULL predicate makes this safe to re-run (a row already
  // owned by another Clerk user — happens if someone changes their
  // Clerk-side email — stays untouched).
  const emailHash = createHash("sha256").update(email.toLowerCase()).digest("hex");
  await db.update(clientContacts)
    .set({ clerkUserId: id })
    .where(and(
      eq(clientContacts.emailHash, emailHash),
      isNull(clientContacts.clerkUserId),
    ));
}
```

### Step 2.4: Run tests

Run: `cd "/Users/giliasraf/Skitza 16.4/apps/web" && pnpm test src/app/api/webhooks/clerk/route.test.ts`

Expected: all 4 tests pass.

### Step 2.5: Run full suite to confirm no regressions

Run: `cd "/Users/giliasraf/Skitza 16.4/apps/web" && pnpm test && pnpm typecheck && pnpm lint`

Expected: all green. Test count: 322 → 326 (4 new tests).

### Step 2.6: Commit

```bash
git add apps/web/src/app/api/webhooks/clerk/route.ts apps/web/src/app/api/webhooks/clerk/route.test.ts
git commit -m "feat(webhook): stamp client_contacts.clerk_user_id on first sign-in

Single SQL UPDATE inside the existing user.created handler. Matches
all client_contacts rows by email_hash and sets clerk_user_id where
it's still null (idempotent — already-stamped rows stay untouched).

After this, the artist app can resolve 'all studios for me' via a
single indexed query on client_contacts.clerk_user_id.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Pure helpers — `emailHashFor` + `groupStudiosForArtist`

**Files:**
- Create: `apps/web/src/server/artist/identity.ts`
- Test: `apps/web/src/server/artist/identity.test.ts`

These are pure functions — no DB, no Clerk. Used by the artist webhook + the artist tRPC procedures + the magic-link soft conversion.

### Step 3.1: Write the failing tests

Create `apps/web/src/server/artist/identity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { emailHashFor, groupStudiosForArtist } from "./identity";

describe("emailHashFor", () => {
  it("lowercases before hashing so 'Dan@x.com' === 'dan@x.com'", () => {
    expect(emailHashFor("Dan@Example.COM")).toBe(emailHashFor("dan@example.com"));
  });

  it("trims surrounding whitespace", () => {
    expect(emailHashFor(" dan@example.com ")).toBe(emailHashFor("dan@example.com"));
  });

  it("returns a 64-char hex sha256", () => {
    expect(emailHashFor("dan@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic across calls", () => {
    const a = emailHashFor("dan@example.com");
    const b = emailHashFor("dan@example.com");
    expect(a).toBe(b);
  });
});

describe("groupStudiosForArtist", () => {
  it("returns one Studio entry per unique producerId", () => {
    const rows = [
      { producerId: "p1", producerName: "Gili Asraf Studio", producerSlug: "giasraf", producerLogoUrl: null, lastSeenAt: new Date("2026-04-15") },
      { producerId: "p2", producerName: "Yossi Productions", producerSlug: "yossi", producerLogoUrl: "https://x/y.png", lastSeenAt: new Date("2026-04-18") },
    ];
    expect(groupStudiosForArtist(rows)).toEqual([
      { producerId: "p2", name: "Yossi Productions", slug: "yossi", logoUrl: "https://x/y.png" },
      { producerId: "p1", name: "Gili Asraf Studio", slug: "giasraf", logoUrl: null },
    ]);
  });

  it("dedupes rows with the same producerId (most-recent lastSeenAt wins)", () => {
    const rows = [
      { producerId: "p1", producerName: "Gili", producerSlug: "g", producerLogoUrl: null, lastSeenAt: new Date("2026-04-10") },
      { producerId: "p1", producerName: "Gili Updated", producerSlug: "g", producerLogoUrl: null, lastSeenAt: new Date("2026-04-15") },
    ];
    const out = groupStudiosForArtist(rows);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("Gili Updated");
  });

  it("sorts by lastSeenAt desc (most recent first)", () => {
    const rows = [
      { producerId: "p1", producerName: "A", producerSlug: "a", producerLogoUrl: null, lastSeenAt: new Date("2026-01-01") },
      { producerId: "p2", producerName: "B", producerSlug: "b", producerLogoUrl: null, lastSeenAt: new Date("2026-04-01") },
      { producerId: "p3", producerName: "C", producerSlug: "c", producerLogoUrl: null, lastSeenAt: new Date("2026-02-01") },
    ];
    expect(groupStudiosForArtist(rows).map(s => s.name)).toEqual(["B", "C", "A"]);
  });

  it("returns [] for empty input", () => {
    expect(groupStudiosForArtist([])).toEqual([]);
  });
});
```

### Step 3.2: Run tests, confirm fail

Run: `cd "/Users/giliasraf/Skitza 16.4/apps/web" && pnpm test src/server/artist/identity.test.ts`

Expected: FAIL with "Cannot find module './identity'".

### Step 3.3: Implement `identity.ts`

Create `apps/web/src/server/artist/identity.ts`:

```ts
import { createHash } from "node:crypto";

// Stable identity key for an email. Hashing happens for two reasons:
// (1) privacy — we never want plaintext email duplicated outside the
// `email` column itself; (2) it's cheap to index a fixed-width hex
// string. Lowercase + trim because Gmail and ClerkBoth treat
// "Dan@x.com" === "dan@x.com" and we follow.
export function emailHashFor(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

// Shape of the row we expect from the artist's SELECT:
type StudioRow = {
  producerId: string;
  producerName: string;
  producerSlug: string;
  producerLogoUrl: string | null;
  lastSeenAt: Date;
};

export type Studio = {
  producerId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
};

// Collapse the artist's per-producer client_contacts rows into a
// deduped, recency-sorted list of Studios. The artist may have N
// rows for the same producer if they've been added multiple times
// (e.g. invited under different emails that later resolved to the
// same Clerk user) — keep only the most-recent name/logo for each.
export function groupStudiosForArtist(rows: StudioRow[]): Studio[] {
  // Map producerId -> most-recent row
  const byProducer = new Map<string, StudioRow>();
  for (const row of rows) {
    const existing = byProducer.get(row.producerId);
    if (!existing || row.lastSeenAt > existing.lastSeenAt) {
      byProducer.set(row.producerId, row);
    }
  }

  return [...byProducer.values()]
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
    .map((r) => ({
      producerId: r.producerId,
      name: r.producerName,
      slug: r.producerSlug,
      logoUrl: r.producerLogoUrl,
    }));
}
```

### Step 3.4: Run tests, confirm pass

Run: `cd "/Users/giliasraf/Skitza 16.4/apps/web" && pnpm test src/server/artist/identity.test.ts`

Expected: 9 passing.

### Step 3.5: Commit

```bash
git add apps/web/src/server/artist/
git commit -m "feat(artist): emailHashFor + groupStudiosForArtist helpers

Pure functions — no DB, no Clerk. emailHashFor consolidates the
email-hash logic that's been duplicated inline in the webhook +
client-contacts router; groupStudiosForArtist takes the artist's
per-producer rows and collapses them into the unique deduped studio
list the StudioSwitcher needs.

9 tests covering: case-insensitivity, whitespace, hex format,
determinism, dedup-on-producerId-with-most-recent-wins, sort by
lastSeenAt desc, empty input.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: tRPC `artistProcedure` middleware + `artist.studios` query

**Files:**
- Create: `apps/web/src/server/trpc/artist-procedure.ts`
- Create: `apps/web/src/server/trpc/routers/artist.ts`
- Modify: `apps/web/src/server/trpc/routers/_app.ts` (mount `artistRouter` at `appRouter.artist`)
- Test: `apps/web/src/server/trpc/routers/__tests__/artist.test.ts`

### Step 4.1: Write the failing test

Create `apps/web/src/server/trpc/routers/__tests__/artist.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

// Mock module that the router will pull from
vi.mock("@skitza/db", async () => {
  const actual = await vi.importActual<object>("@skitza/db");
  return { ...actual };
});

describe("artist.studios", () => {
  it("rejects UNAUTHORIZED when no userId in context", async () => {
    // Build a caller with ctx.userId = null
    // Expect TRPCError code "UNAUTHORIZED"
  });

  it("returns deduped + sorted studios for the signed-in artist", async () => {
    // Mock DB to return 3 rows across 2 producers
    // Expect 2 Studio entries, sorted by lastSeenAt desc
  });

  it("returns [] when artist has no studios yet (brand-new sign-in)", async () => {
    // Mock DB to return []
    // Expect []
  });
});
```

Use the mock-DB pattern from `apps/web/src/server/stripe/customer.test.ts` for consistency.

### Step 4.2: Run, confirm fail

Run: `cd "/Users/giliasraf/Skitza 16.4/apps/web" && pnpm test src/server/trpc/routers/__tests__/artist.test.ts`

Expected: FAIL with "Cannot find module".

### Step 4.3: Implement `artist-procedure.ts`

Create `apps/web/src/server/trpc/artist-procedure.ts` (mirror `producer-procedure.ts` shape):

```ts
import { TRPCError } from "@trpc/server";
import { createDb } from "@skitza/db";
import { publicProcedure } from "./init";

// Resolves the caller's Clerk user id and DB handle. Unlike
// producerProcedure, we DON'T require a producers row — the artist
// might be brand new (no studio relationships yet) and we still want
// to render the welcome screen for them.
//
// What we DO require: a Clerk session. Anonymous traffic doesn't
// belong here.
export const artistProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "missing DATABASE_URL" });
  }
  const db = createDb(dbUrl);
  return next({ ctx: { ...ctx, db, clerkUserId: ctx.userId } });
});
```

### Step 4.4: Implement `artist.ts` router

Create `apps/web/src/server/trpc/routers/artist.ts`:

```ts
import { eq, clientContacts, producers } from "@skitza/db";
import { router } from "../init";
import { artistProcedure } from "../artist-procedure";
import { groupStudiosForArtist } from "~/server/artist/identity";

// Artist-scoped router. All procedures here resolve "my studios" via
// client_contacts.clerk_user_id (stamped on first sign-in by the
// Clerk user.created webhook).
export const artistRouter = router({
  // List all producers the signed-in artist has worked with.
  // Drives the Studio Switcher in the artist app header.
  studios: artistProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        producerId: clientContacts.producerId,
        producerName: producers.displayName,
        producerSlug: producers.slug,
        producerLogoUrl: producers.brand,
        lastSeenAt: clientContacts.lastSeenAt,
      })
      .from(clientContacts)
      .innerJoin(producers, eq(producers.id, clientContacts.producerId))
      .where(eq(clientContacts.clerkUserId, ctx.clerkUserId));

    // brand is jsonb {logoUrl?: string, ...} — normalize to scalar
    const flat = rows.map((r) => ({
      producerId: r.producerId,
      producerName: r.producerName ?? "Untitled Studio",
      producerSlug: r.producerSlug,
      producerLogoUrl:
        (r.producerLogoUrl as { logoUrl?: string } | null)?.logoUrl ?? null,
      lastSeenAt: r.lastSeenAt,
    }));

    return { studios: groupStudiosForArtist(flat) };
  }),
});
```

### Step 4.5: Mount the router

Modify `apps/web/src/server/trpc/routers/_app.ts`. Add to the `appRouter` definition:

```ts
import { artistRouter } from "./artist";
// ...
export const appRouter = router({
  // ...existing routers
  artist: artistRouter,
});
```

### Step 4.6: Run tests, confirm pass + full suite green

```bash
cd "/Users/giliasraf/Skitza 16.4/apps/web"
pnpm test src/server/trpc/routers/__tests__/artist.test.ts
pnpm test && pnpm typecheck && pnpm lint
```

Expected: 3 new tests passing, full suite green, lint + typecheck clean.

### Step 4.7: Commit

```bash
git add apps/web/src/server/trpc/
git commit -m "feat(artist): artistProcedure middleware + studios query

artistProcedure: requires Clerk session, doesn't require a producers
row (brand-new artists have no studios yet but still need to render
the welcome screen).

artist.studios: SELECTs client_contacts joined with producers, runs
through groupStudiosForArtist to dedupe + sort. Single query + one
index hit on client_contacts.clerk_user_id (Task 1).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: `/artist` route group + role detection layout + AppShell

**Files:**
- Create: `apps/web/src/app/(artist)/artist/layout.tsx`
- Create: `apps/web/src/app/(artist)/artist/page.tsx` (placeholder Home, fleshed out in Task 7)
- Create: `apps/web/src/app/(artist)/artist/welcome/page.tsx`
- Create: `apps/web/src/components/artist/artist-app-shell.tsx`
- Create: `apps/web/src/components/artist/bottom-nav.tsx`
- Modify: `apps/web/src/middleware.ts` (add `/artist(.*)` to protected routes)

### Step 5.1: Extend middleware to protect `/artist`

Modify `apps/web/src/middleware.ts`:

```ts
const isProtected = createRouteMatcher([
  "/dashboard(.*)",
  "/projects(.*)",
  "/settings(.*)",
  "/onboarding(.*)",
  "/artist(.*)",  // NEW
]);
```

### Step 5.2: Implement role detection layout

Create `apps/web/src/app/(artist)/artist/layout.tsx`:

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createDb, eq, producers, clientContacts } from "@skitza/db";
import { ArtistAppShell } from "~/components/artist/artist-app-shell";

// Server component. Runs on every /artist/* navigation. Decides:
// 1. Not signed in → /sign-in (handled by middleware, but defense-
//    in-depth here).
// 2. Signed in, no studios yet → /artist/welcome (different layout
//    chrome — no bottom nav, no switcher, just a CTA-driven splash).
// 3. Signed in, ≥1 studio → render <ArtistAppShell> with the tab.
//
// We deliberately don't preload the artist's studios for the shell
// here — the Studio Switcher fetches its own data via tRPC. This
// keeps layout fast (one query for role detection, not two).
export default async function ArtistLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/artist");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");
  const db = createDb(dbUrl);

  // Role detection: count studios for this Clerk user.
  // If 0 AND the user is not also a producer → welcome screen.
  const [studioRow] = await db
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(eq(clientContacts.clerkUserId, userId))
    .limit(1);

  const [producerRow] = await db
    .select({ id: producers.id })
    .from(producers)
    .where(eq(producers.clerkUserId, userId))
    .limit(1);

  if (!studioRow && !producerRow) {
    redirect("/artist/welcome");
  }

  return <ArtistAppShell isProducer={!!producerRow}>{children}</ArtistAppShell>;
}
```

### Step 5.3: Implement `ArtistAppShell` + `BottomNav`

Create `apps/web/src/components/artist/artist-app-shell.tsx`:

```tsx
import Link from "next/link";
import { BottomNav } from "./bottom-nav";

// Wraps the artist app. Header (Studio Switcher + producer link
// when applicable) + main content + persistent mini-player + bottom
// nav. The mini-player is mounted in Task 6; for now render a
// placeholder div so the layout reserves space and tabs scroll
// without overlapping.
export function ArtistAppShell({
  isProducer,
  children,
}: {
  isProducer: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-dvh bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]/85 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          {/* Studio Switcher slot — Task 12 */}
          <span className="font-display text-lg tracking-tight">Skitza</span>
        </div>
        {isProducer ? (
          <Link
            href="/dashboard"
            className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-primary))]"
          >
            ← Studio
          </Link>
        ) : null}
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-32 pt-6 sm:pb-40">{children}</main>

      {/* Persistent mini-player slot — Task 6. Reserve 64px so
          BottomNav doesn't sit flush against the player when both
          render. */}
      <div className="fixed inset-x-0 bottom-16 z-20 h-16" id="artist-mini-player-slot" />

      <BottomNav />
    </div>
  );
}
```

Create `apps/web/src/components/artist/bottom-nav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/artist", label: "Home", icon: "🏠" },
  { href: "/artist/music", label: "Music", icon: "🎵" },
  { href: "/artist/book", label: "Book", icon: "🗓️" },
  { href: "/artist/store", label: "Store", icon: "🛍️" },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  // "Home" is the only path that needs an exact match; the others
  // light up on any descendant route (e.g. /artist/music/abc123).
  const isActive = (href: string) =>
    href === "/artist" ? pathname === "/artist" : pathname.startsWith(href);

  return (
    <nav
      role="navigation"
      aria-label="Artist app tabs"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]/95 backdrop-blur"
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-4">
        {TABS.map((tab) => {
          const active = isActive(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className={`flex flex-col items-center gap-0.5 py-3 text-[0.66rem] font-mono uppercase tracking-wider transition-colors ${
                  active
                    ? "text-[rgb(var(--brand-primary))]"
                    : "text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-secondary))]"
                }`}
              >
                <span aria-hidden className="text-base">{tab.icon}</span>
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

### Step 5.4: Placeholder Home + Welcome pages

Create `apps/web/src/app/(artist)/artist/page.tsx`:

```tsx
export default function ArtistHomePage() {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl tracking-tight">
        Hey there.
      </h1>
      <p className="text-sm text-[rgb(var(--fg-secondary))]">
        Home tab — fleshed out in Task 7.
      </p>
    </div>
  );
}
```

Create `apps/web/src/app/(artist)/artist/welcome/page.tsx`:

```tsx
import Link from "next/link";

// Brand-new sign-in with no studio relationships yet. We can't
// magically know which producers want to work with this artist —
// they need an invite link. So the welcome screen sets expectations
// and offers to take them to the public producer directory (when
// that exists; for now just a help link).
export default function ArtistWelcomePage() {
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="font-display text-3xl tracking-tight">
        Welcome to Skitza.
      </h1>
      <p className="mt-4 text-sm text-[rgb(var(--fg-secondary))]">
        Once a producer invites you to work on a project, your studios
        will show up here. Ask the producer to send you a Skitza link
        — clicking it from the same email address you used to sign in
        will connect everything automatically.
      </p>
      <p className="mt-8 text-xs text-[rgb(var(--fg-muted))]">
        Already have an invite link?
      </p>
      <Link
        href="/sign-out"
        className="mt-2 inline-block text-sm text-[rgb(var(--brand-primary))] underline decoration-dotted underline-offset-2"
      >
        Sign out + click the invite from your email
      </Link>
    </div>
  );
}
```

### Step 5.5: Manual smoke-check

Run: `cd "/Users/giliasraf/Skitza 16.4/apps/web" && pnpm dev`

Visit `http://localhost:3000/artist` while signed in.

- If you have any `client_contacts` row matching your Clerk email → see "Hey there." Home placeholder + bottom nav with 4 tabs
- If you have no rows → redirected to `/artist/welcome`
- If signed out → redirected to `/sign-in`

Stop the dev server.

### Step 5.6: Run tests, typecheck, lint

```bash
cd "/Users/giliasraf/Skitza 16.4/apps/web"
pnpm test && pnpm typecheck && pnpm lint
```

Expected: all green (no new tests; this task is mostly UI scaffolding tested in subsequent tasks).

### Step 5.7: Commit

```bash
git add apps/web/src/middleware.ts apps/web/src/app/\(artist\)/ apps/web/src/components/artist/
git commit -m "feat(artist): /artist route group + AppShell + BottomNav

Layout does role detection (signed in? has studios? also a producer?)
and routes accordingly. ArtistAppShell wraps every /artist/*
page with the sticky header + bottom nav + reserved space for the
persistent mini-player (next task).

BottomNav is a thin client component — Link-based so route changes
don't lose the audio element when it lands in Task 6.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: ArtistAudioContext + PersistentMiniPlayer

**Files:**
- Create: `apps/web/src/components/artist/artist-audio-context.tsx`
- Create: `apps/web/src/components/artist/persistent-mini-player.tsx`
- Modify: `apps/web/src/components/artist/artist-app-shell.tsx` (mount the provider + mini-player)
- Test: `apps/web/src/components/artist/__tests__/artist-audio-context.test.ts`

### Step 6.1: Write failing tests for the reducer

ArtistAudioContext is mostly React state, but the state-transition logic is testable as a pure reducer. Extract it.

Create `apps/web/src/components/artist/__tests__/artist-audio-context.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { audioReducer, type AudioState } from "../artist-audio-context";

const empty: AudioState = {
  currentTrack: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  pendingComment: null,
};

describe("audioReducer", () => {
  it("PLAY_TRACK loads a track + sets isPlaying true", () => {
    const next = audioReducer(empty, {
      type: "PLAY_TRACK",
      track: { id: "t1", url: "https://x/y.mp3", title: "Summer", producerName: "Gili", artworkUrl: null },
    });
    expect(next.currentTrack?.id).toBe("t1");
    expect(next.isPlaying).toBe(true);
    expect(next.position).toBe(0);
    expect(next.pendingComment).toBe(null);
  });

  it("TOGGLE_PLAY flips isPlaying without changing track", () => {
    const playing: AudioState = { ...empty, currentTrack: { id: "t1", url: "u", title: "T", producerName: "P", artworkUrl: null }, isPlaying: true };
    expect(audioReducer(playing, { type: "TOGGLE_PLAY" }).isPlaying).toBe(false);
    expect(audioReducer(playing, { type: "TOGGLE_PLAY" }).currentTrack?.id).toBe("t1");
  });

  it("TOGGLE_PLAY is a no-op when no track is loaded", () => {
    const next = audioReducer(empty, { type: "TOGGLE_PLAY" });
    expect(next).toEqual(empty);
  });

  it("SET_POSITION updates position only", () => {
    const next = audioReducer(empty, { type: "SET_POSITION", position: 42 });
    expect(next.position).toBe(42);
  });

  it("REQUEST_COMMENT pauses + records the timestamp", () => {
    const playing: AudioState = { ...empty, currentTrack: { id: "t1", url: "u", title: "T", producerName: "P", artworkUrl: null }, isPlaying: true, position: 73 };
    const next = audioReducer(playing, { type: "REQUEST_COMMENT" });
    expect(next.isPlaying).toBe(false);
    expect(next.pendingComment).toEqual({ time: 73 });
  });

  it("DISMISS_COMMENT clears the pending comment without resuming", () => {
    const withComment: AudioState = { ...empty, currentTrack: { id: "t1", url: "u", title: "T", producerName: "P", artworkUrl: null }, isPlaying: false, position: 73, pendingComment: { time: 73 } };
    const next = audioReducer(withComment, { type: "DISMISS_COMMENT" });
    expect(next.pendingComment).toBe(null);
    expect(next.isPlaying).toBe(false);
  });
});
```

### Step 6.2: Run tests, confirm fail

Run: `cd "/Users/giliasraf/Skitza 16.4/apps/web" && pnpm test src/components/artist/__tests__/artist-audio-context.test.ts`

Expected: FAIL with "Cannot find module".

### Step 6.3: Implement the context + reducer

Create `apps/web/src/components/artist/artist-audio-context.tsx`:

```tsx
"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode,
} from "react";

export type Track = {
  id: string;
  url: string;
  title: string;
  producerName: string;
  artworkUrl: string | null;
};

export type AudioState = {
  currentTrack: Track | null;
  isPlaying: boolean;
  position: number; // seconds
  duration: number; // seconds; 0 until metadata loads
  pendingComment: { time: number } | null;
};

type AudioAction =
  | { type: "PLAY_TRACK"; track: Track }
  | { type: "TOGGLE_PLAY" }
  | { type: "SET_POSITION"; position: number }
  | { type: "SET_DURATION"; duration: number }
  | { type: "REQUEST_COMMENT" }
  | { type: "DISMISS_COMMENT" };

export function audioReducer(state: AudioState, action: AudioAction): AudioState {
  switch (action.type) {
    case "PLAY_TRACK":
      return { ...state, currentTrack: action.track, isPlaying: true, position: 0, pendingComment: null };
    case "TOGGLE_PLAY":
      if (!state.currentTrack) return state;
      return { ...state, isPlaying: !state.isPlaying };
    case "SET_POSITION":
      return { ...state, position: action.position };
    case "SET_DURATION":
      return { ...state, duration: action.duration };
    case "REQUEST_COMMENT":
      if (!state.currentTrack) return state;
      return { ...state, isPlaying: false, pendingComment: { time: state.position } };
    case "DISMISS_COMMENT":
      return { ...state, pendingComment: null };
  }
}

const initialState: AudioState = {
  currentTrack: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  pendingComment: null,
};

type ContextShape = {
  state: AudioState;
  playTrack: (track: Track) => void;
  togglePlay: () => void;
  requestComment: () => void;
  dismissComment: () => void;
  // Internal: called by the audio element via ref
  setPosition: (s: number) => void;
  setDuration: (s: number) => void;
};

const ArtistAudioContext = createContext<ContextShape | null>(null);

export function ArtistAudioProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(audioReducer, initialState);
  const playTrack = useCallback((track: Track) => dispatch({ type: "PLAY_TRACK", track }), []);
  const togglePlay = useCallback(() => dispatch({ type: "TOGGLE_PLAY" }), []);
  const requestComment = useCallback(() => dispatch({ type: "REQUEST_COMMENT" }), []);
  const dismissComment = useCallback(() => dispatch({ type: "DISMISS_COMMENT" }), []);
  const setPosition = useCallback((s: number) => dispatch({ type: "SET_POSITION", position: s }), []);
  const setDuration = useCallback((s: number) => dispatch({ type: "SET_DURATION", duration: s }), []);

  return (
    <ArtistAudioContext.Provider
      value={{ state, playTrack, togglePlay, requestComment, dismissComment, setPosition, setDuration }}
    >
      {children}
    </ArtistAudioContext.Provider>
  );
}

export function useArtistAudio() {
  const ctx = useContext(ArtistAudioContext);
  if (!ctx) throw new Error("useArtistAudio must be used inside <ArtistAudioProvider>");
  return ctx;
}
```

### Step 6.4: Implement `PersistentMiniPlayer`

Create `apps/web/src/components/artist/persistent-mini-player.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { useArtistAudio } from "./artist-audio-context";

// Singleton <audio> element. Renders nothing visual when no track is
// loaded. Otherwise: artwork + title + producer name + play/pause +
// progress bar. The actual <audio> stays mounted forever (lives in
// the layout) so tab navigation never interrupts playback.
export function PersistentMiniPlayer() {
  const { state, togglePlay, setPosition, setDuration } = useArtistAudio();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Sync DOM <audio>.play() / pause() with React state
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (state.isPlaying && el.paused) void el.play().catch(() => {});
    else if (!state.isPlaying && !el.paused) el.pause();
  }, [state.isPlaying, state.currentTrack?.id]);

  // Reload src when track changes
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !state.currentTrack) return;
    if (el.src !== state.currentTrack.url) {
      el.src = state.currentTrack.url;
      void el.play().catch(() => {});
    }
  }, [state.currentTrack?.url]);

  if (!state.currentTrack) return null;

  return (
    <div className="fixed inset-x-0 bottom-16 z-20 mx-auto flex max-w-2xl items-center gap-3 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-2 shadow-[0_-4px_20px_-8px_rgb(0_0_0_/_0.4)]">
      {state.currentTrack.artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={state.currentTrack.artworkUrl}
          alt=""
          className="h-10 w-10 rounded-sm object-cover"
        />
      ) : (
        <div className="h-10 w-10 rounded-sm bg-[rgb(var(--bg-sunken))]" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{state.currentTrack.title}</p>
        <p className="truncate text-xs text-[rgb(var(--fg-muted))]">
          {state.currentTrack.producerName}
        </p>
      </div>
      <button
        type="button"
        onClick={togglePlay}
        aria-label={state.isPlaying ? "Pause" : "Play"}
        className="rounded-full bg-[rgb(var(--brand-primary))] p-2 text-[rgb(var(--bg-base))]"
      >
        {state.isPlaying ? "⏸" : "▶"}
      </button>
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        preload="metadata"
      />
    </div>
  );
}
```

### Step 6.5: Mount the provider in the AppShell

Modify `apps/web/src/components/artist/artist-app-shell.tsx`. Wrap `children` with `<ArtistAudioProvider>` and replace the placeholder div with `<PersistentMiniPlayer />`:

```tsx
import { ArtistAudioProvider } from "./artist-audio-context";
import { PersistentMiniPlayer } from "./persistent-mini-player";
// ...
return (
  <ArtistAudioProvider>
    <div className="relative min-h-dvh ...">
      <header>...</header>
      <main>{children}</main>
      <PersistentMiniPlayer />
      <BottomNav />
    </div>
  </ArtistAudioProvider>
);
```

Drop the placeholder `<div id="artist-mini-player-slot" />`.

### Step 6.6: Run tests

```bash
cd "/Users/giliasraf/Skitza 16.4/apps/web"
pnpm test src/components/artist/__tests__/artist-audio-context.test.ts
pnpm test && pnpm typecheck && pnpm lint
```

Expected: 6 new reducer tests passing, full suite green.

### Step 6.7: Commit

```bash
git add apps/web/src/components/artist/
git commit -m "feat(artist): persistent mini-player + audio context

Singleton <audio> element lives in the AppShell so tab navigation
never remounts it. State machine via useReducer + Context (pure
reducer covered by 6 tests). Tracks current song, play/pause state,
position/duration, and a 'pendingComment' transient for the Music
tab's Comment button (Task 9 wires it up).

Mini-player renders nothing until a track is loaded — no visual
chrome wasted on empty state.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Home tab — next session, latest mix, balance, activity feed

**Files:**
- Modify: `apps/web/src/app/(artist)/artist/page.tsx` (replace placeholder with real Home)
- Modify: `apps/web/src/server/trpc/routers/artist.ts` (add `home` query)
- Test: `apps/web/src/server/trpc/routers/__tests__/artist-home.test.ts`

### Step 7.1: Write failing test for `artist.home`

Create `apps/web/src/server/trpc/routers/__tests__/artist-home.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("artist.home", () => {
  it("returns null fields when artist has no studios", async () => {
    // expects: { nextSession: null, latestMix: null, outstandingBalance: null, activity: [] }
  });

  it("returns the next confirmed session across all studios", async () => {
    // 2 bookings, one tomorrow @ studio A, one next week @ studio B
    // expects: nextSession.startsAt = tomorrow's date, producerName = A's name
  });

  it("returns the most recently uploaded track across all studios", async () => {
    // expects latestMix populated with track id + producer info
  });

  it("returns outstanding balance as sum of unpaid invoices.amount_cents", async () => {
    // 2 unpaid invoices: 250000 + 500000
    // expects: outstandingBalance = { totalCents: 750000, currency: "USD", nextDueAt: ... }
  });

  it("returns recent activity sorted desc, capped at 10", async () => {
    // mix uploads + bookings + payments
    // expects array of {kind, message, occurredAt} sorted by occurredAt desc, max 10
  });
});
```

(Don't fully implement these test bodies if it's too much — pick the 2-3 most meaningful and stub the rest with `it.skip`. The implementer should fill them in as they implement each branch.)

### Step 7.2: Implement `artist.home`

Add to `apps/web/src/server/trpc/routers/artist.ts`:

```ts
home: artistProcedure.query(async ({ ctx }) => {
  // 1. Find all my client_contacts
  const myContacts = await ctx.db
    .select({ id: clientContacts.id, producerId: clientContacts.producerId, email: clientContacts.email })
    .from(clientContacts)
    .where(eq(clientContacts.clerkUserId, ctx.clerkUserId));

  if (myContacts.length === 0) {
    return { nextSession: null, latestMix: null, outstandingBalance: null, activity: [] };
  }

  const myEmails = [...new Set(myContacts.map((c) => c.email))];
  const myProducerIds = [...new Set(myContacts.map((c) => c.producerId))];

  // 2. Next confirmed session (booking with status='confirmed' AND startsAt > now)
  // 3. Latest mix (most-recent track_versions across my projects, joined by artistEmail)
  // 4. Outstanding balance (sum of invoices.amount_cents WHERE status != 'paid' AND project owned by me)
  // 5. Activity feed (last 10 events: track upload / booking confirmed / invoice paid)

  // ... see test file for expected shape ...
}),
```

(Implementer: this is a bigger query — break into parallel `Promise.all` for performance. Use `inArray` for the my-emails / my-producerIds filters. Reference `apps/web/src/server/trpc/routers/booking.ts` for similar shapes.)

### Step 7.3: Implement `/artist/page.tsx`

Replace the placeholder with a Home page that fetches via the tRPC server caller and renders 4 sections:

```tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { appRouter } from "~/server/trpc/routers/_app";

export default async function ArtistHomePage() {
  const { userId } = await auth();
  if (!userId) return null;
  const caller = appRouter.createCaller({ userId });
  const data = await caller.artist.home();
  // ... render <NextSessionCard /> <LatestMixCard /> <BalanceCard /> <ActivityFeed />
}
```

Each card is a small component in `apps/web/src/components/artist/home/*.tsx`. Keep them as small Server Components — pure projection of the data.

### Step 7.4: Run tests + typecheck + lint, commit

```bash
git add apps/web/src/
git commit -m "feat(artist): Home tab with 4 cards

Single tRPC query (artist.home) fans out via Promise.all to find:
next confirmed session, latest mix, outstanding balance, and a
10-item activity feed across all my studios. Each card is a small
Server Component — Home renders entirely on the server, no client
JS needed for the cards themselves.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Music tab — projects list

**Files:**
- Create: `apps/web/src/app/(artist)/artist/music/page.tsx`
- Modify: `apps/web/src/server/trpc/routers/artist.ts` (add `music.projects` query)
- Create: `apps/web/src/components/artist/music/project-card.tsx`
- Test: `apps/web/src/server/trpc/routers/__tests__/artist-music.test.ts`

### Step 8.1: TDD the `music.projects` query

Write fail-first tests for:
- Returns [] when artist has no studios
- Returns one entry per project owned by my client_contacts (joined by artistEmail = clientContacts.email)
- Sorts by most-recent-track-upload desc
- Includes producer name + producer slug for the StudioSwitcher context

### Step 8.2: Implement `music.projects` and the page

Page is a list of `<ProjectCard />` components. Each card shows: project title, producer name, latest track title, "Last updated" timestamp. Tap → `/artist/music/[projectId]`.

### Step 8.3: Run tests + commit

```bash
git add apps/web/src/
git commit -m "feat(artist): Music tab — projects list

artist.music.projects returns my projects across all studios sorted
by most-recent-track-upload. Tap a project → routes to the Now
Playing screen (Task 9). Empty state matches the design philosophy:
single inline CTA back to Home rather than a wordy explanation.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Music — Now Playing screen with timestamped comments

**Files:**
- Create: `apps/web/src/app/(artist)/artist/music/[projectId]/page.tsx`
- Create: `apps/web/src/app/(artist)/artist/music/[projectId]/now-playing.tsx` (client component)
- Modify: `apps/web/src/server/trpc/routers/artist.ts` (add `music.project` query)
- Test: `apps/web/src/server/trpc/routers/__tests__/artist-music-project.test.ts`

### Step 9.1: TDD the `music.project` query

- Returns track + version history + existing comments + access guard (must own this project via clientContacts)

### Step 9.2: Implement Now Playing UI

- Waveform via wavesurfer.js (reuse the existing portfolio player component if compatible)
- Version switcher (V1 / V2 / Master)
- Inline comment list below waveform
- "Add Comment" button → triggers `audio.requestComment()` from Task 6 → opens text input pre-filled with current timestamp
- Submit → `trpc.artist.music.addComment.mutate({trackVersionId, timeMs, body})` → optimistic update

### Step 9.3: Commit

```bash
git add apps/web/src/
git commit -m "feat(artist): Now Playing screen with timestamped comments

Waveform via wavesurfer (reused from portfolio player). Add Comment
pauses via the persistent mini-player's REQUEST_COMMENT action
(Task 6) so the timestamp captured matches what the artist hears.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Book tab — block-based weekly calendar

**Files:**
- Create: `apps/web/src/app/(artist)/artist/book/page.tsx`
- Create: `apps/web/src/app/(artist)/artist/book/booking-client.tsx`
- Modify: `apps/web/src/server/trpc/routers/artist.ts` (add `book.availability` + `book.confirm` mutations)
- Modify: `apps/web/src/server/trpc/routers/booking.ts` (extract availability resolver if it's not already pure)
- Test: `apps/web/src/server/trpc/routers/__tests__/artist-book.test.ts`

### Step 10.1: TDD the block-based availability resolver

The existing producer booking already has block availability logic — see `apps/web/src/server/trpc/routers/booking.ts`. Pull that logic into a pure helper if it isn't already, so this task just wraps it for the artist context.

Tests:
- Returns 7 days starting from today
- Each day has 0, 1, or 2 blocks (Morning / Evening) based on producer's `availability_blocks` config
- Blocks marked unavailable if there's any conflicting booking that overlaps
- Smart Project Association: if artist has an active paid project with this producer, response includes `freeBookingProjectId: <id>`

### Step 10.2: Implement the picker

Horizontal-scroll week strip + day cards with Morning/Evening blocks. Tap a block → bottom sheet with start times → confirm.

If `freeBookingProjectId` is set → confirmation card shows "On the house — included in your {projectTitle} project."
Otherwise → routes to `/artist/store/[productId]?intent=book` to pick a service.

### Step 10.3: Commit

```bash
git add apps/web/src/
git commit -m "feat(artist): Book tab with block-based weekly calendar

Reuses the producer-side block availability resolver. Smart Project
Association lights up the 'On the house' badge when an active paid
project exists with this studio, otherwise routes to Store.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: Store tab — embedded plan picker

**Files:**
- Create: `apps/web/src/app/(artist)/artist/store/page.tsx`
- Create: `apps/web/src/app/(artist)/artist/store/[productId]/page.tsx`
- Modify: `apps/web/src/server/trpc/routers/artist.ts` (add `store.products` query)
- Reuse: `apps/web/src/app/(public)/p/[slug]/book/plan-picker.tsx` (extract into a shared component if it's currently coupled to the public booking page)

### Step 11.1: List products from current studio (toggle "All studios")

`store.products` takes optional `producerId` filter. When omitted, returns products from all studios the artist works with — sorted by current studio first, then alphabetical.

### Step 11.2: Product detail = existing plan picker

The plan picker we built in Task 5 of the auto-installments plan (`docs/plans/2026-04-18-stripe-auto-installments.md`) is reusable. Extract it from the public booking page if needed; embed it in `/artist/store/[productId]`.

### Step 11.3: Commit

```bash
git add apps/web/src/
git commit -m "feat(artist): Store tab + embedded plan picker

artist.store.products returns products from one or all studios the
artist works with. The Product Detail page reuses the plan picker
from the public booking flow — same Checkout, same Stripe flow,
just rendered inside the artist app shell.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: Studio Switcher header component

**Files:**
- Create: `apps/web/src/components/artist/studio-switcher.tsx`
- Modify: `apps/web/src/components/artist/artist-app-shell.tsx` (mount the switcher in the header)

### Step 12.1: Implement Studio Switcher

Client component fetching `trpc.artist.studios.useQuery()`. Renders:
- If 0 or 1 studio: shows the producer logo + name as static text (no dropdown)
- If 2+ studios: same chip + a downward chevron; click opens a dropdown listing all studios; selecting one updates the URL search param `?studio=<producerId>` and forces a re-render of the active tab

Active studio is read from `searchParams.studio` and falls back to the most-recently-active one (first item in `groupStudiosForArtist`).

### Step 12.2: Wire into existing tabs

Each tab (`Home`, `Music`, `Book`, `Store`) reads the `studio` search param to scope its data. Update the queries to take an optional `producerId` filter — defaults to "current selection" when present, "all studios" when not.

### Step 12.3: Commit

```bash
git add apps/web/src/
git commit -m "feat(artist): Studio Switcher in header

Renders as static logo when artist has 1 studio; opens a dropdown
when 2+. URL param ?studio=<id> drives the active selection so links
are shareable and back-button navigation works naturally.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 13: Soft sign-in banner on magic-link surfaces

**Files:**
- Modify: `apps/web/src/app/(public)/share/[token]/page.tsx` (add SoftSignInBanner when not signed in OR when signed in but the project's producer matches one of the artist's stamped studios)
- Modify: `apps/web/src/app/(public)/p/[slug]/book/success/page.tsx` (add SaveYourStudios CTA after a successful checkout)
- Create: `apps/web/src/components/artist/soft-signin-banner.tsx`

### Step 13.1: Implement the banner

```tsx
export function SoftSignInBanner({ returnUrl }: { returnUrl: string }) {
  // Renders only when:
  // - Visitor is NOT signed in (fallback CTA), or
  // - Signed in but landed on an old magic link (offers "View in app")
  // dismiss-once-per-token via localStorage so we don't nag
}
```

### Step 13.2: Wire into share/[token]/page.tsx

The page is already a Server Component. After resolving project access, conditionally render the banner above the existing layout.

For `/sign/[token]` → don't add the banner (mid-flow distraction is harmful).

For `/p/[slug]/book/success` → after the checkout-success message, add a "Save your studios — sign in with Google" CTA that routes to `/sign-in?redirect_url=/artist?welcome=1`.

### Step 13.3: Commit

```bash
git add apps/web/src/
git commit -m "feat(magic-link): soft sign-in banner on share + success pages

Drive-by clients keep working as today. Anyone who clicks the banner
flows into the artist app and gets their existing magic-link rows
auto-stamped on first sign-in (Task 2). One-shot dismiss via
localStorage prevents nagging.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 14: First-touch welcome flow + edit-products UI bug fix

**Files:**
- Create: `apps/web/src/app/(artist)/artist/welcome-modal.tsx` (client component shown when `?welcome=1`)
- Modify: `apps/web/src/app/(artist)/artist/page.tsx` (mount the welcome modal conditionally)
- Modify: `apps/web/src/app/(app)/dashboard/booking/package-toolbar.tsx` (add Edit button next to existing Delete on each product row)
- Modify: `apps/web/src/app/(app)/dashboard/booking/package-form.tsx` (accept an `initialProduct` prop for edit mode — the prop already exists from Task 4 of the auto-installments plan, just wire it up)

### Step 14.1: Welcome modal

When the URL has `?welcome=1`, render a one-time modal explaining the 4 tabs. Dismissible; on dismiss, replace the URL to drop the param.

### Step 14.2: Edit-products bug fix

The user noticed they can only DELETE products from the dashboard, not edit them. Add an Edit button that opens the existing `<NewPackageForm>` (which already supports `initialPlans`/`initialProduct` props from Task 4 of the auto-installments build).

### Step 14.3: Commit

```bash
git add apps/web/src/app/\(artist\)/artist/welcome-modal.tsx apps/web/src/app/\(artist\)/artist/page.tsx apps/web/src/app/\(app\)/dashboard/booking/
git commit -m "feat(artist): welcome modal + fix dashboard edit-product UI gap

WelcomeModal: one-time explainer of the 4 tabs after first sign-in.
Triggered via ?welcome=1 search param so it can be linked from the
checkout-success CTA + the producer's invite copy.

Bonus: closes the 'I can only delete products, not edit' gap noted
during yesterday's QA. The PackageForm already accepts the props
needed for edit mode (Task 4 of auto-installments) — this just adds
the Edit button to the producer's product row toolbar.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 15: Manual QA + production rollout

### Step 15.1: Vercel preview deploy

Push the branch:
```bash
cd "/Users/giliasraf/Skitza 16.4" && git push -u origin feat/artist-app
```

Open the resulting PR. Vercel auto-deploys a preview URL.

### Step 15.2: Manual QA checklist (run on preview, NOT prod)

- [ ] Sign out, hit `/artist` → redirected to `/sign-in?redirect_url=/artist`
- [ ] Sign in as a brand-new user (no client_contacts rows) → land on `/artist/welcome` with the explainer
- [ ] Sign in as a producer (has `producers` row, no client_contacts) → still routed to welcome (or producer dashboard, depending on detection logic — confirm)
- [ ] Sign in as an artist with 1 studio → land on `/artist` Home, see 4 tabs in bottom nav, Studio Switcher renders as static logo
- [ ] Sign in as an artist with 2+ studios → Studio Switcher dropdown lists all
- [ ] Click Music → see project list → tap a project → Now Playing loads with waveform
- [ ] Tap Comment → input appears with current timestamp pre-filled → submit → comment appears in list
- [ ] Switch to Book tab → mini-player keeps playing the audio uninterrupted
- [ ] Pick a Morning block → start time → confirm → booking lands on producer's calendar
- [ ] If artist has active paid project → confirmation card shows "On the house — Summer Project"
- [ ] Tap Store → see services from current studio + toggle "All studios" → product detail loads → plan picker renders → checkout works (use `tok_visa`)
- [ ] Old magic link still works: `/share/[old-token]` loads with the soft sign-in banner above the existing layout
- [ ] Visit `/dashboard/booking` (producer side) → click Edit on a product → form opens with current values + plan checkboxes pre-filled

### Step 15.3: Merge + production deploy

After QA passes:
```bash
gh pr merge --squash
```

Vercel auto-deploys main. Verify:
- `/artist` → 200 (when signed in)
- `/share/[token]` → 200 (still works with old tokens)
- `/p/[slug]/book` → 200 (public booking unchanged)

### Step 15.4: Mark plan complete

```bash
git checkout main
git pull
git commit --allow-empty -m "docs: mark artist app plan as shipped"
git push
```

---

## Success criteria

When this plan is complete:
- [ ] An artist signs in with Google → lands on a Spotify-style 4-tab app
- [ ] Persistent mini-player works across tab navigation (no re-buffering)
- [ ] Studio Switcher correctly lists all producers the artist has worked with
- [ ] Old magic-link clients can still access their projects without signing in
- [ ] Soft sign-in banner converts willing clients without nagging dismissed ones
- [ ] All 4 tabs scope their data correctly to the active studio
- [ ] First-touch flow lands a brand-new artist on a useful screen with one obvious next action
- [ ] Producer can now edit (not just delete) their products
- [ ] Full test suite (336+ tests) passes; typecheck + lint clean
- [ ] Manual QA checklist all green on preview before merging to main

---

## Out of scope (don't build these in this plan)

- Native iOS/Android apps (Tauri Mac shell remains; mobile = PWA)
- Push notifications via APNs/FCM
- Cross-studio analytics dashboards ("you've spent $X across N studios")
- In-app chat between artist and producer
- Edit global artist profile (name, photo) — Clerk owns these
- Apple Pay / Google Pay one-tap re-purchase (Stripe Checkout already handles inline)
- Offline mode beyond shell-level service-worker cache
