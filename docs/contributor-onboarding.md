# Contributor Onboarding — Skitza

> **Welcome.** This doc is designed to take a developer from zero to productive on Skitza in about one focused afternoon. Read it front-to-back the first time. After that it becomes a reference — skip to the section you need.

> **Context:** Skitza is a solo-founder product (Gili Asraf). Gili is non-technical; the codebase is AI-maintained with Gili as product owner. You're being brought in as a collaborator, so the first thing to understand is **how we work** (BMAD + TDD + observability-first debugging) — that's covered in §5.

---

## Table of contents

1. [What Skitza is](#1-what-skitza-is)
2. [Tech stack](#2-tech-stack)
3. [Repo layout](#3-repo-layout)
4. [Running locally](#4-running-locally)
5. [How we work (non-negotiable)](#5-how-we-work-non-negotiable)
6. [Architecture at a glance](#6-architecture-at-a-glance)
7. [Crucial flows you must understand before touching them](#7-crucial-flows-you-must-understand-before-touching-them)
8. [Conventions](#8-conventions)
9. [Testing discipline](#9-testing-discipline)
10. [Database + migrations](#10-database--migrations)
11. [Deployment + environments](#11-deployment--environments)
12. [Observability](#12-observability)
13. [Current state (as of 2026-04-23)](#13-current-state-as-of-2026-04-23)
14. [Tribal knowledge / gotchas](#14-tribal-knowledge--gotchas)
15. [Where to ask for help](#15-where-to-ask-for-help)

---

## 1. What Skitza is

**One-line:** "The one app a solo music producer opens in the morning."

**Pitch:** Skitza replaces the Calendly + Samply + Notion + DocuSign + Stripe + WhatsApp stack with a single product. A producer drops one permanent link (`skitza.app/p/<slug>`) in their Instagram bio → artists click → they listen to past work → they sign up → they book a session → contract + invoice + project room materialize automatically. Zero manual client entry on the producer's side.

**Two audiences, one codebase:**

- **Producers** — authenticated app at `/dashboard`. 4 screens: Today / Projects / Music / Setup.
- **Artists** — authenticated app at `/artist`. 4 tabs: Home / Music / Book / Store. Plus public surfaces at `/p/<slug>` and `/p/<slug>/book`.

**Status:** Pre-launch. Soft launch target late April / early May 2026 with the first 5 producers.

**Full product vision:** [`docs/product/PRD.md`](product/PRD.md) — 27 sections, 70+ locked decisions. **Treat the PRD as normative.** The Q&A journey that produced each decision is at [`docs/decisions/360-prd-answers.md`](decisions/360-prd-answers.md).

---

## 2. Tech stack

Canonical list lives in [PRD §27](product/PRD.md). Summarized here:

| Layer | Choice | Why |
|---|---|---|
| **Framework** | Next.js 15 App Router | Server Components + server actions + Route Handlers are core to our architecture |
| **Language** | TypeScript (`exactOptionalPropertyTypes: true`) | Strict mode across the monorepo |
| **Monorepo** | pnpm workspaces | `apps/web` + `apps/desktop` + `packages/db` |
| **Styling** | Tailwind v4 | All colors/radii/shadows via CSS custom properties — **no hex codes** (see §8) |
| **API** | tRPC v11 | Three procedure bases: `publicProcedure`, `producerProcedure`, `artistProcedure` |
| **DB** | Drizzle ORM + Neon Postgres | Single source of truth: `packages/db/src/schema.ts` |
| **Auth** | Clerk v7 | Plus `unsafeMetadata` as the signup-origin channel (artist vs. producer distinction) |
| **Storage** | Cloudflare R2 (S3-compatible) | Direct browser-to-R2 multipart uploads via presigned URLs |
| **Payments** | Stripe Connect Express + Subscription Schedules | Producers onboard to their own Stripe account |
| **Email** | Resend via React Email | Templates in `apps/web/src/server/email/templates/` |
| **Audio** | wavesurfer.js | Waveform rendering + scrubbing |
| **Tests** | Vitest | Plus a mock-DB pattern using table markers (§9) |
| **Desktop** | Tauri 2 | Thin shell loading the web app |
| **Observability** | Sentry + PostHog | Installed 2026-04-23. Sentry catches errors; PostHog tracks usage. |
| **Hosting** | Vercel (Hobby tier, pre-launch) | Fluid Compute by default, Node.js 24 |
| **i18n** | next-intl | **Scope = authenticated app only.** Landing + public routes are English-only LTR. See §8. |

---

## 3. Repo layout

```
.
├── apps/
│   ├── web/                      # Next.js app (primary)
│   │   ├── src/
│   │   │   ├── app/              # App Router — route groups:
│   │   │   │   ├── (app)/            # Producer dashboard (authed)
│   │   │   │   ├── (artist)/         # Artist app (authed)
│   │   │   │   ├── (artist-welcome)/ # Artist welcome splash
│   │   │   │   ├── (onboarding)/     # Producer first-run wizard
│   │   │   │   ├── (public)/         # /p/<slug>, /p/<slug>/book, /m/<token>
│   │   │   │   ├── (auth)/           # Clerk sign-in / sign-up
│   │   │   │   ├── api/              # Webhook + cron routes
│   │   │   │   ├── layout.tsx        # Root — MUST stay lang="en" dir="ltr"
│   │   │   │   └── page.tsx          # Landing marketing page
│   │   │   ├── components/
│   │   │   │   ├── shell/            # AppShell, Sidebar, NotificationBell, CmdPalette
│   │   │   │   ├── dashboard/        # Producer: Today, Projects, Music, Setup, Project Room
│   │   │   │   ├── artist/           # Artist app shell, bottom nav, studio switcher
│   │   │   │   ├── project/          # Reusable project pieces
│   │   │   │   ├── audio/            # WaveformPlayer, AudioUploader, PersistentPlayer
│   │   │   │   ├── landing/          # Marketing sections — English only, never use t()
│   │   │   │   └── ui/               # Primitives (Button, Badge, EmptyState, Toast, Card)
│   │   │   ├── server/
│   │   │   │   ├── trpc/routers/     # Routers: producer, artist, project, booking, etc.
│   │   │   │   ├── payments/         # plan.ts (pure math), checkout.ts, customer.ts
│   │   │   │   ├── storage/          # r2.ts + r2-cors.ts (bucket CORS policy)
│   │   │   │   ├── artist/           # identity helpers (emailHashFor, groupStudiosForArtist)
│   │   │   │   └── email/            # Transactional templates (React Email) + dispatchers
│   │   │   ├── lib/
│   │   │   │   ├── projects/         # stages.ts, states.ts (single source of truth)
│   │   │   │   ├── time/             # relative.ts — formatRelativeTime, fmtDateTime
│   │   │   │   ├── magic-links/      # token.ts (JWT sign/verify)
│   │   │   │   └── keyboard/         # use-shortcuts.ts, G-leader bindings
│   │   │   ├── i18n/                 # next-intl config + app-i18n-provider.tsx
│   │   │   └── middleware.ts         # Clerk auth + legacy redirects
│   │   ├── messages/                 # en.json + he.json + ar.json (authed app only)
│   │   ├── scripts/                  # One-shot ops scripts (apply-r2-cors, changelog, etc.)
│   │   └── public/                   # sw.js, static assets
│   └── desktop/                      # Tauri 2 shell (rare touch)
├── packages/
│   └── db/
│       ├── src/schema.ts             # Drizzle schema — single source of truth
│       ├── drizzle/                  # Generated SQL migrations (0000-0033)
│       │   └── meta/_journal.json    # ⚠ OUT OF SYNC past 0018 — see §10
│       └── apply-migrations.mjs      # Direct neon-http runner (use this, not drizzle-kit)
├── docs/
│   ├── INDEX.md                      # Master map — READ FIRST EVERY SESSION
│   ├── session_recap.md              # LIVE handoff snapshot (overwritten at checkpoints)
│   ├── audit-report.md               # Paper trail of every known bug + its fix
│   ├── product/PRD.md                # Product vision — NORMATIVE
│   ├── decisions/                    # WHY the PRD says what it says
│   ├── plans/active/                 # Current implementation plans
│   ├── plans/archive/                # Shipped plans (historical)
│   ├── plans/stories/                # Per-story artifacts
│   ├── qa/                           # Phase + pre-merge review artifacts
│   └── bmad-workflow.md              # How to collaborate with Claude (BMAD playbook)
├── .claude/                          # Project-scoped Claude config
├── .github/workflows/                # CI
├── vercel.json                       # Crons + Vercel config (Hobby — max 1 cron/day)
├── CLAUDE.md                         # HOW we work (conventions, commands, mistake log)
├── README.md                         # Public-facing pitch + pointer to INDEX
└── docs/contributor-onboarding.md    # You are here
```

---

## 4. Running locally

### Prerequisites

- **Node.js 24** (latest LTS — Vercel default)
- **pnpm** (for monorepo)
- **Access to:**
  - The Neon Postgres dev DB (Gili shares the connection string)
  - Clerk dev keys (Gili shares via password manager or 1password)
  - Cloudflare R2 dev credentials (optional — only needed if you touch audio upload)
  - Stripe test-mode keys (optional — only needed if you touch payments)

### Clone + install

```bash
git clone https://github.com/giasraf/skitza-v2.git
cd skitza-v2
pnpm install
```

### Env vars

Copy the example file, then fill in secrets Gili shares with you:

```bash
cp apps/web/.env.local.example apps/web/.env.local
# Edit apps/web/.env.local with the real values
```

**Minimum required to run the app:**

```
DATABASE_URL=<neon dev connection string>
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...
MAGIC_LINK_SECRET=<any 32+ char random string>
SITE_URL=http://localhost:3000
```

**Optional (per-feature):**

- `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_BUCKET_AUDIO` + `R2_BUCKET_DOCS` + `R2_PUBLIC_BASE` — audio uploads
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` — payments
- `RESEND_API_KEY` — email sending
- `CRON_SECRET` — cron auth
- `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_ORG` + `SENTRY_PROJECT` + `SENTRY_AUTH_TOKEN` — Sentry
- `NEXT_PUBLIC_POSTHOG_KEY` — PostHog

### Run dev server

```bash
pnpm -F web dev             # web on http://localhost:3000
```

### Verify pipeline (run BEFORE every commit)

```bash
pnpm -F web typecheck       # tsc --noEmit
pnpm -F web lint            # eslint
pnpm -F web test            # vitest run
# or all three:
pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test
```

There's also a project slash command: `/skitza-verify`.

### DB workflow

```bash
pnpm -F @skitza/db db:studio         # Drizzle Studio (GUI)
pnpm -F @skitza/db db:generate       # Generate new migration from schema changes
# ⚠ DO NOT use db:migrate — it's broken. See §10.
```

---

## 5. How we work (non-negotiable)

This is the most important section. Read it twice.

### 5.1 BMAD is mandatory for product-change requests

Gili is non-technical. When Gili asks for a feature or fix, the work goes through **BMAD** (Breakthrough Method for Agile AI-Driven Development), a structured 5-role pipeline:

1. **Analyst** — 3 questions + 1-page brief at `docs/plans/<date>-<feature>-brief.md`
2. **PM** — PRD delta committed to `docs/product/PRD.md` **BEFORE any code**
3. **Architect** — technical design with file paths + tRPC signatures + migration refs
4. **Scrum Master** (for Large track only) — self-contained story files at `docs/plans/stories/`
5. **Dev + QA** — Dev uses TDD in a fresh subagent per story; QA is spec-compliance + UX critique

**3 tracks** — pick by scope:

- **Quick** — typo/copy/one-line fix → skip to Dev
- **Standard** (default, 80% of requests) — 2-10 files → Brief → PRD delta → Architecture lite → Dev → QA
- **Large** — new surface / schema change / multi-sub-tab → full 5-phase pipeline

**Why this matters for you:** if Gili pings you with "can you add X" in Telegram, **the BMAD process still applies**. Don't start coding. Run it through the Analyst phase. The full playbook is at [`docs/bmad-workflow.md`](bmad-workflow.md).

**Magic phrases Gili uses:**

- `Quick BMAD: <thing>` — trivial, skip to Dev
- `Standard BMAD: <thing>` — default
- `Large BMAD: <thing>` — big scope
- `BMAD me: <thing>` — you pick the track
- `skip BMAD` — explicit override (note the risk)

### 5.2 TDD is mandatory for production code

**Rule:** failing test first, RED-verified (you must see the failure message), then GREEN. Applies to:

- New features
- Bug fixes that add code branches, error handlers, or defensive wrappers
- Any behavior that could regress silently

**Skips TDD legitimately:**

- Pure infra (applying a migration, adding env vars, running a setup script)
- Config-only changes (tsconfig, eslint, etc.)

**Real example from 2026-04-22:** Claude shipped a try/catch wrapper in `publicProfile.forJoin` without a failing test first. User called it out. Remediation: wrote the test after the fact, temporarily reverted the fix to prove RED, restored the fix, confirmed GREEN. **Without the RED phase, a test can pass vacuously and pin nothing.**

### 5.3 Commit discipline

- **Prefix:** `feat(scope):`, `fix(scope):`, `refactor(scope):`, `docs(scope):`, `ci:`, `test:`
- **Imperative mood:** "add" not "added"
- **Co-Authored-By line for Claude-generated work:** `Co-Authored-By: Claude <noreply@anthropic.com>`
- **NEVER `git commit --amend`** — always new commits, even for small fixes. Gili explicitly prefers this. Amending rewrites history and makes bisecting harder.
- **NEVER `git push --force` to shared branches.**
- **Don't skip hooks** (no `--no-verify`).
- **Frequent small commits.** Each commit should be revertable independently.

### 5.4 Branch flow

- `main` is push-protected. All changes go through PRs.
- Feature branches: `feat/<scope>-<short-desc>` or `fix/<scope>-<short-desc>`
- PR titles follow the same prefix convention as commit messages
- Squash-merge is the default (keeps main history clean)

### 5.5 Docs discipline

Every PR that fixes an audit task must update `docs/audit-report.md`:

1. Flip the Status tracker row from ⏳ Pending → ✅ Fixed with today's date + PR ref
2. Append a dated entry to that task's **Fix Log** (never delete history — only append)

**When multiple PRs touch `audit-report.md`, expect cascading conflicts.** Resolution pattern (§14).

---

## 6. Architecture at a glance

### Two apps, one codebase

- **Producer dashboard** at `/dashboard` — authed via `producerProcedure`; requires a `producers` row
- **Artist app** at `/artist` — authed via `artistProcedure`; does NOT require a `producers` row (artists sign up as artists)
- **Public surfaces** at `/`, `/p/<slug>`, `/p/<slug>/book`, `/m/<token>` — no auth or magic-link auth
- **Dual-role users** (someone who is both a producer and an artist-of-another-producer) are supported — the UserButton menu shows "Producer dashboard" link for these

### Role isolation (Task 16 fix, 2026-04-22)

A helper at `apps/web/src/server/auth/role.ts` resolves whether a Clerk user is producer, artist, or both, and redirects them to the correct surface. `resolveUserRole` takes already-fetched facts and returns a role; `getUserRoleFromClerkUserId` is the convenience that fetches then calls. Respect the helper — don't reinvent role checks.

### tRPC pattern

Three procedure bases injected at `ctx`:

```ts
publicProcedure    // no auth, rate-limited
producerProcedure  // requires Clerk session + producers row; ctx.producerId + ctx.db
artistProcedure    // requires Clerk session; ctx.userId + ctx.emailHash; NO producer row required
```

**Aggregation pattern:** Single-round-trip payloads (e.g. `producer.today`, `artist.home`) use `Promise.all` across fan-out queries. Each leg scopes by tenant in its own `WHERE`. See `producer.ts` `today` procedure for the canonical 9-way fan-out.

**Error codes:** Throw `TRPCError` with specific codes:

- `UNAUTHORIZED` — not signed in
- `FORBIDDEN` — signed in but not authorized
- `NOT_FOUND` — resource doesn't exist (used for ALL auth-failed paths on magic links to prevent enumeration)
- `CONFLICT` — uniqueness violation (e.g. slug taken)
- `TOO_MANY_REQUESTS` — rate limit

### RSC boundary (learned the hard way 2026-04-23)

**Rule:** Never export non-component (lowercase) functions or consts from a `"use client"` file if any server component might import them.

**Why:** RSC forbids invoking a function defined in a client module from server code. Gives a runtime error (`Attempted to call X() from the server but X is on the client`).

**Pattern:** Extract pure types + predicates into a plain `.ts` module that has no `"use client"` directive and no browser APIs. The client component can still import from it. Example: `project-sub-tab-shared.ts` + `project-sub-tabs.tsx` — see Task 18 fix.

**Test invariant for this class of bug:**

```ts
it("does NOT start with 'use client' directive", () => {
  const src = readFileSync(new URL("../project-sub-tab-shared.ts", import.meta.url), "utf8");
  const firstLine = src.split("\n").find((l) => l.trim().length > 0);
  expect(firstLine?.trim().startsWith('"use client"')).toBe(false);
});
```

---

## 7. Crucial flows you must understand before touching them

### 7.1 Producer signup → onboarding → dashboard

1. Visitor lands on `/` (landing page — English only, LTR always)
2. Clicks Sign Up → Clerk hosted auth → creates Clerk user
3. **Clerk webhook** at `/api/webhooks/clerk` fires → branches on `unsafeMetadata` to detect signup origin
4. If producer signup: creates a `producers` row with default slug
5. User lands on `/onboarding` (5-step wizard per PRD §4.5 — currently 4-step, Task 4 pending)
6. Wizard completes → dashboard

**Files:** `apps/web/src/app/(auth)/`, `apps/web/src/app/(onboarding)/`, `apps/web/src/app/api/webhooks/clerk/`

**⚠ Quarantined** (do NOT touch without Sentry data — see §14):

- Sign-in `forceRedirectUrl` bug
- Artist-welcome race condition

### 7.2 `/join/<slug>` signup routes to ARTIST (not producer)

**Task 15 fix 2026-04-22.** When someone hits `skitza.app/join/<slug>` and signs up, they should be registered as an **artist** of that producer, not as a new producer.

Implementation:

- `/sign-up/join/<slug>/[[...rest]]/page.tsx` — Clerk catch-all that sets `unsafeMetadata: { signupOrigin: "artist", producerSlug: "<slug>" }`
- Webhook branches on that metadata to create a `client_contacts` row instead of a `producers` row
- `(app)/layout` redirects authed artists away from producer routes

### 7.3 Audio upload (multipart, browser → R2)

1. Producer opens project → Music sub-tab → clicks Upload
2. Client calls `initAudioUpload` server action → returns `{ uploadId, key }` from R2's `CreateMultipartUploadCommand`
3. Client splits file into 5MB parts; for each: `signAudioPart` returns a presigned PUT URL
4. Client does `fetch(url, { method: "PUT", body: blob })` **directly from browser to R2**
5. ETags captured from response headers → passed to `completeAudioUpload` → assembles manifest, calls `CompleteMultipartUploadCommand`
6. Track version row in DB gets the final key + public URL

**⚠ CORS requirement** (learned 2026-04-23, Task 19): The R2 bucket must have a CORS policy allowing PUT from `skitza.app`, `*.vercel.app`, `localhost:3000` with `ExposeHeaders: ["ETag"]`. Policy lives in `apps/web/src/server/storage/r2-cors.ts`, applied via `apps/web/scripts/apply-r2-cors.mjs`.

**Key files:**

- `apps/web/src/lib/audio/use-multipart-upload.ts` — hook that drives the upload
- `apps/web/src/components/audio/audio-uploader.tsx` — UI
- `apps/web/src/app/(app)/dashboard/audio-upload-actions.ts` — server actions
- `apps/web/src/server/trpc/routers/audio.ts` — tRPC endpoints
- `apps/web/src/server/storage/r2.ts` — R2 client + key builders

### 7.4 Magic links (share tokens, signup invites)

JWT-signed short-lived tokens for:

- Artist clicks share link in email → lands on `/share/<token>` → auto-sign-in if email matches
- Producer shares a project with a client → `/p/<slug>/book/<token>` prefills booking form

**File:** `apps/web/src/lib/magic-links/token.ts` (sign + verify)

### 7.5 Payments (Stripe Connect + Subscription Schedules)

Producers onboard to their own Stripe account via Connect Express. Three payment plans:

- **full** — one Checkout at booking time
- **split_50_50** — deposit at booking, final charge fired off-session via saved PM post-delivery
- **monthly** — Subscription Schedule with N charges

**Pure math:** `apps/web/src/server/payments/plan.ts` — `calculateCharges(plan, totalAmountCents)` returns the cents per charge. Fully tested.

**Webhook:** `/api/webhooks/stripe` handles `invoice.paid`, `checkout.session.completed`, `charge.refunded`, etc.

### 7.6 Autopilot cron (behaviors 1+3 live, behavior 2 deferred)

Scheduled cron at `/api/cron/autopilot` (not yet on `vercel.json` — Hobby tier slot used by session-reminders):

1. **unpaid-reminder** — 7+ day old unpaid invoices → Resend email + stamp `reminder_sent_at`
2. **request-testimonial** — detect-only (count eligible) until `/t/<token>` capture form ships
3. **auto-archive** — 30+ day old `paid` projects → flip to `archived`

Auth: `Bearer $CRON_SECRET`. See `apps/web/src/app/api/cron/autopilot/route.ts`.

---

## 8. Conventions

### 8.1 CSS — no hex codes, ever

All colors/radii/shadows go through CSS custom properties defined in `apps/web/src/app/globals.css`:

```tsx
// ✅ Correct
className="bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))] border-[rgb(var(--border-subtle))] rounded-[var(--radius-md)]"

// ❌ Never
className="bg-blue-500 text-red-600"
style={{ background: "#f3f4f6" }}
```

**Key tokens:** `--bg-base`, `--bg-elevated`, `--bg-overlay`, `--fg-primary`, `--fg-secondary`, `--fg-muted`, `--fg-inverse`, `--fg-warning`, `--fg-danger`, `--brand-primary`, `--brand-accent`, `--border-subtle`, `--border-strong`, `--radius-sm`, `--radius-md`, `--radius-lg`.

**Alpha gotcha:** Use the `/0.08` suffix. Do NOT nest `var()` with fallback inside `rgb()` with alpha:

```tsx
// ✅ Works
className="bg-[rgb(var(--fg-danger)/0.08)]"

// ❌ Parser fails silently
className="bg-[rgb(var(--fg-danger,var(--brand-primary))/0.08)]"
```

### 8.2 Animation primitives

All animation is CSS-only (no framer-motion). Primitives in `globals.css`:

- `.sk-lift` — hover lift
- `.sk-pop` / `.sk-pop-center` — dropdown/modal fade+scale-in
- `.sk-cta-shine` — CTA shimmer
- `.sk-pulse-hover` — breathing glow
- `.reveal-up` — mount fade+slide
- `.pulse-glow` — persistent brand pulse

**Every primitive MUST have a `@media (prefers-reduced-motion: reduce)` gate.** There's a test at `apps/web/src/app/__tests__/motion-primitives.test.ts` that fails CI if a new primitive skips it.

### 8.3 Responsive + a11y

- **Mobile-first.** Every new layout must work at 360px before 1280px.
- **Touch targets ≥ 44×44** on mobile — use `.sk-tap` utility.
- **iOS safe-area** — `.sk-safe-top`, `.sk-safe-bottom`, `.sk-safe-x`.
- **Momentum scrolling** on horizontal rails via `.sk-scroll-x`.
- **`:focus-visible`** (not `:focus`) so mouse clicks don't trigger rings.
- **Tabs:** `id="tab-<key>"` + `aria-controls="panel-<key>"` on the tab; `id="panel-<key>"` + `aria-labelledby="tab-<key>"` on the panel. Both IDs must match.
- **Nav active:** `aria-current="page"`, NOT `aria-pressed`.
- **Dialogs/modals:** `role="dialog"` + `aria-modal="true"` + Esc to close.

### 8.4 i18n scope (important)

1. **Landing page + public routes are ENGLISH ONLY, LTR ONLY.** No `t()`, no `NextIntlClientProvider`, no locale cookie effects.
2. The `<html>` element at root layout is ALWAYS `lang="en" dir="ltr"`. Do NOT put conditional `dir` on `<html>` — it breaks hydration with next-themes + Clerk UserButton. (Caused a production crash 2026-04-20.)
3. RTL applies per-route-group via `<AppI18nProvider>` which wraps only authenticated groups: `(app)`, `(artist)`, `(artist-welcome)`, `(onboarding)`.
4. **Default locale: `en`** for everyone. No IP-based auto-detection.
5. Hebrew is opt-in via the language chip in the sidebar footer (writes `NEXT_LOCALE=he` cookie).
6. Translation files: `apps/web/messages/{en,he,ar}.json`. Arabic is stubbed empty.

---

## 9. Testing discipline

### 9.1 Placement

- Unit tests next to the file: `foo.test.ts` or `__tests__/foo.test.ts`
- tRPC router tests: `apps/web/src/server/trpc/routers/__tests__/`
- DB integration tests: `packages/db/src/__tests__/` (need `DATABASE_URL_TEST`)

### 9.2 Mock-DB pattern (tRPC tests)

Use **marker objects** to branch by table. Example from `artist-home.test.ts`:

```ts
const projectsMarker = { __table: "projects" };
const bookingsMarker = { __table: "bookings" };

const dbMock = {
  select: () => ({
    from: (table: unknown) => {
      if (table === projectsMarker) { /* ... */ }
      if (table === bookingsMarker) { /* ... */ }
      throw new Error(`unexpected select().from(${String(table)})`);
    },
  }),
};

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  projects: projectsMarker,
  bookings: bookingsMarker,
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...args: unknown[]) => ({ and: args }),
}));
```

### 9.3 Auth-scoping assertions

Walk the `WHERE` predicate tree with the `findPredicate` helper to assert tenant-scoped queries:

```ts
const where = lastWhereArgs as unknown;
expect(findPredicate(where, producersMarker, "id", ctx.producerId)).toBe(true);
```

This catches silent regressions that drop tenant-scoping predicates.

### 9.4 Input validation

Always use Zod. Nested `z.object({ ... }).strict()` for tight schemas.

### 9.5 TDD cadence

Canonical RED → GREEN → refactor. Every bug fix starts with a failing test. Check commits on `main` for recent fix examples — Tasks 18 + 19 both ship with RED-verified TDD sequences documented in their PR bodies.

---

## 10. Database + migrations

### 10.1 The journal is broken past 0018

`packages/db/drizzle/meta/_journal.json` only tracks through migration **0018**. Migrations **0019–0033** exist as `.sql` files but are NOT in the journal. Consequence: `drizzle-kit migrate` skips them. **Do NOT use `drizzle-kit migrate`.**

### 10.2 Apply migrations manually

```bash
set -a && . apps/web/.env.local && set +a
node packages/db/apply-migrations.mjs
```

The runner reads each `drizzle/*.sql`, strips BEGIN/COMMIT, and executes statements via neon-http's tagged-template trick. All migrations are idempotent (`ADD COLUMN IF NOT EXISTS`, etc.) so re-running is safe.

There's also a project slash command: `/skitza-migrate`.

### 10.3 Writing new migrations

1. Change `packages/db/src/schema.ts`
2. `pnpm -F @skitza/db db:generate` — produces `drizzle/NNNN_<name>.sql`
3. **Verify idempotence** — `ADD COLUMN IF NOT EXISTS`, `CREATE … IF NOT EXISTS`
4. Use `BEGIN; … COMMIT;` blocks so the migration is atomic
5. Sanity-check existing rows don't break (use `NOT NULL DEFAULT` when adding non-null columns)
6. Apply via `/skitza-migrate` — do NOT touch `_journal.json`
7. Apply to prod post-merge via the same command with prod `DATABASE_URL`

### 10.4 Neon HTTP quirk

`sql.query(stmt)` and `sql.unsafe(stmt)` don't exist in the neon HTTP client. The only way to run raw SQL without placeholders is:

```js
sql(Object.assign([stmt], { raw: [stmt] }))
```

The `apply-migrations.mjs` runner uses this pattern.

---

## 11. Deployment + environments

### 11.1 Vercel

- **Production domain:** `skitza.app`
- **Preview URLs:** `skitza-v2-web-<hash>-gili-asrafs-projects.vercel.app`
- **Hobby tier** (pre-launch) — 1 daily cron limit (used by session-reminders)
- **Node.js 24 default, Fluid Compute default**
- **`vercel.json`** holds crons + config
- **Env vars** live on Vercel only — never committed. Three environments: Production / Preview / Development. Always set vars in all three unless a var is specifically env-scoped.

### 11.2 CI

GitHub Actions run typecheck + lint + test + build on every PR. Currently red due to a billing block on Gili's account — treat CI as advisory until resolved. Always run the local gate before pushing.

### 11.3 Merging

- All PRs go through review (currently Gili + Claude; now + you)
- Squash-merge by default
- Branch is auto-deleted on merge
- Vercel redeploys prod on every merge to `main`

---

## 12. Observability

Installed 2026-04-23 (PR #32, verified in `docs/qa/2026-04-23-observability-verification.md`).

### 12.1 Sentry — "what's broken"

- Captures errors from client + server + edge with stack traces, release attribution, user context (via Clerk identify)
- Config files: `apps/web/sentry.{client,server,edge}.config.ts` + `instrumentation.ts`
- **Check Sentry Issues tab daily** — it's the first stop when diagnosing any prod bug
- Session Replay is auto-enabled (records the ~30s before an error)

### 12.2 PostHog — "what are users doing"

- Autocapture (clicks + pageviews) + Clerk identify
- `/ingest/*` is a Next rewrite proxy to dodge ad-blockers
- Provider: `apps/web/src/components/observability/posthog-provider.tsx`
- **Check Activity / Live Events tab** to see real-user behavior
- Session replays available under each user

### 12.3 Vercel runtime logs

The most underrated tool. Get real function logs via the Vercel MCP or CLI:

```bash
vercel logs <deployment-url>
```

Or programmatically via the MCP server (Claude uses this to debug).

### 12.4 Debug pattern for prod bugs

1. Gili reports "this page is broken"
2. Get the URL + error reference digest if visible
3. Pull Vercel runtime logs filtered by that path / time window
4. If you see a stack trace → root-cause from there
5. If no server log → suspect a client-side or infra issue (CORS, network, third-party)
6. For third-party (R2, Stripe, Resend, etc.): curl + OPTIONS preflight to isolate

---

## 13. Current state (as of 2026-04-23)

### 13.1 Audit progression

**11 of 19 tracked tasks ✅ Fixed (58% closed).** Live tracker: [`docs/audit-report.md`](audit-report.md).

Remaining ⏳ Pending tasks (in rough priority order):

- **Task 3** — S04 UI (embed parsers + /join Section B render) — PR #28 has most of it
- **Task 4** — onboarding wizard 4 → 5 steps (PRD §4.5 — missing Portfolio + Stripe steps)
- **Task 5** — `/refund-policy` content
- **Task 6** — cookie banner (EU compliance)
- **Task 7** — Privacy + Terms (counsel review required)
- **Task 9** — kill `/dashboard/booking` (duplicates Setup)
- **Task 10** — landing page TODO placeholders
- **Task 17 Phases 2+3** — artist desktop sidebar salvage (preserved on a dead branch)

### 13.2 Known bugs on main (quarantine list)

Now diagnosable with Sentry + PostHog live. **Do NOT touch these files until we have ~1 week of real-user data:**

1. `/sign-in` line 8: `forceRedirectUrl="/dashboard"` ignores `redirect_url` query param
2. `/artist-welcome` (no slug) has no role guard for authed users with real studios
3. Webhook race on `/artist-welcome/<slug>` — fast-clickers land on `/artist` before `client_contacts` row exists

**Quarantined files:**

- `apps/web/src/app/(auth)/sign-in/*`, `/sign-up/*`
- `apps/web/src/app/(artist)/artist/layout.tsx`
- `apps/web/src/app/(artist-welcome)/**/*`
- `apps/web/src/app/api/webhooks/clerk/**/*`

### 13.3 Launch clock

Day 3 of a 12-week post-launch roadmap. Soft launch target: late April / early May 2026 with 5 producers.

---

## 14. Tribal knowledge / gotchas

### 14.1 Never export lowercase functions from `"use client"` files that a server component might import

**Rule:** If a pure function or predicate is needed on both sides of the RSC boundary, extract it into a plain `.ts` module with no `"use client"` directive. Pin with an invariant test.

### 14.2 R2 (and any browser-direct-to-storage) needs CORS upfront

**Rule:** Before shipping any feature that uploads directly from the browser to a storage service, make sure the bucket's CORS policy exists. Policy + setup script for Skitza: `apps/web/src/server/storage/r2-cors.ts` + `apps/web/scripts/apply-r2-cors.mjs`. Must `ExposeHeaders: ["ETag"]` for multipart.

### 14.3 Migration journal drift

Always use `node packages/db/apply-migrations.mjs`, never `drizzle-kit migrate`.

### 14.4 `audit-report.md` cascading conflicts

Every fix PR appends a row + fix log to the audit report. Merging PRs sequentially conflicts every PR after the first. Resolution pattern:

1. `git checkout <branch> && git fetch origin main && git rebase origin/main`
2. Edit the conflict block — **keep both halves** of the status table + add the incoming row
3. Stale `(Task X, PR pending)` → replace with actual `(PR #N)` as you rebase
4. `git add docs/audit-report.md && git rebase --continue`
5. Re-verify gates (`pnpm -F web typecheck lint test`)
6. `git push --force-with-lease` + `gh pr merge --squash --delete-branch`

### 14.5 Never accept credentials via chat

Even "public" keys (`NEXT_PUBLIC_POSTHOG_KEY` ends up in the browser bundle anyway). Same channel could later carry a Stripe secret. Keep the habit universal: copy straight from source (Sentry/PostHog/Clerk/Stripe dashboard) to destination (Vercel env vars). Never through a middleman — not chat, not email, not Slack.

### 14.6 No-key smoke tests for SaaS integrations

Verify a third-party integration is live without leaking a key. Example for PostHog:

```bash
curl -s "https://skitza.app/ingest/decide?v=3" -H "Content-Type: application/json" -d '{"token":"dummy"}'
```

Expect the upstream service to respond with an authentication error (`The provided API key is invalid or has expired.`). That proves (1) the proxy rewrite is live, (2) the upstream is receiving requests and validating keys. No real secret required.

### 14.7 "Failed to fetch" → CORS preflight

`TypeError: Failed to fetch` with no HTTP status in the response = almost always CORS preflight blocked. First diagnostic: `curl -X OPTIONS <url> -H "Origin: https://skitza.app" -H "Access-Control-Request-Method: <method>"`.

### 14.8 Local-main commits that duplicate PRs

If you commit a doc locally on `main` while the same doc is queued in an open PR, when that PR lands on origin your local commit will conflict with its own merged-back-via-PR version. Solutions:

- **Preferred:** commit the doc on a branch from the start
- **If already on main:** `git reset --hard origin/main` and re-author on a branch

### 14.9 Small things

- **`rgb(var(--fg-danger,var(--brand-primary))/0.08)` fails silently** — nested `var()` with fallback inside `rgb()` with alpha doesn't parse. Strip the fallback.
- **Conditional `dir="rtl"` on `<html>` crashes production** — breaks hydration with next-themes + Clerk UserButton. Keep root `<html>` at `lang="en" dir="ltr"`; scope i18n to authed route groups only.
- **`.success` toast variant is affectively wrong for "this isn't wired yet"** — green tint = wrong cue. Use `info` for non-success confirmations.
- **`sk-cta-shine` + other motion primitives require a `prefers-reduced-motion: reduce` gate** — tested by CI.

---

## 15. Where to ask for help

- **Gili** — product questions, priorities, brand tone, anything user-facing
- **Claude** — anything code-y; ping in Cowork or via `.claude/` agents on your own machine. Claude has session context via `docs/session_recap.md` and full project memory via CLAUDE.md.
- **`docs/INDEX.md`** — if you can't find something in a dozen files, check the INDEX map first
- **`docs/audit-report.md`** — if you think you found a bug, check if it's already tracked
- **Vercel MCP + logs** — before guessing at any prod bug, pull the actual runtime logs

### Helpful slash commands

- `/skitza-verify` — run the full gate (typecheck + lint + test + build)
- `/skitza-migrate` — apply pending SQL migrations against `$DATABASE_URL`
- `/skitza-preview` — print the Vercel preview URL for the current branch
- `/checkpoint` — update `docs/session_recap.md` with the latest state

### Canonical files to bookmark

| File | When to read |
|---|---|
| [`docs/session_recap.md`](session_recap.md) | Every session start |
| [`docs/INDEX.md`](INDEX.md) | Navigation |
| [`docs/audit-report.md`](audit-report.md) | Before touching any file with known bugs |
| [`docs/product/PRD.md`](product/PRD.md) | Any product question |
| [`CLAUDE.md`](../CLAUDE.md) | HOW we work — conventions, commands, mistakes |
| [`docs/bmad-workflow.md`](bmad-workflow.md) | How to collaborate on new features with Gili |

---

## Final note

The shortest version of this document:

> **Before you write code, ask "has this gone through BMAD?" Before you write a fix, ask "do I have a RED-verified failing test?" Before you claim anything is green, ask "did I run `pnpm -F web typecheck lint test` on this branch tip, after the latest rebase?" Before you touch a quarantined file, ask "do I have Sentry data to prove I understand what I'm fixing?"**

Four yeses and you're safe. One "no" and you pause.

Welcome aboard. 🎧

*Last updated: 2026-04-23 · Contact: Gili Asraf*
