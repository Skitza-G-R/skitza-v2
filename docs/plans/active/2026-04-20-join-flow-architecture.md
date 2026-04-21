# `/join/<slug>` Flow — Architecture

> **Phase:** BMAD Architect · **Track:** Large · **PRD:** §6.1-6.6 (just committed as `b891098`)
> **Branch:** `feat/join-flow`
> **Ships as:** one stacked set of stories on this branch → one PR → merge to main

---

## Walking-skeleton-first scope

This is a large feature. Rather than building everything in one marathon, we ship in **two waves**:

### Wave 1 (tonight — minimum viable `/join`)

Goal: a working `skitza.app/join/gili-asraf` that a stranger can visit, see Gili's samples, and sign up — even if not every bell and whistle is wired.

- **S01** — `is_public_sample` toggle on portfolio tracks + producer UI + query filter
- **S02** — `/join/<slug>` route skeleton: shows producer info + public samples + signup CTA + "streaming links coming soon" placeholder
- **S03** — kill `/p/<slug>` + `/p/<slug>/book` routes; all old URLs 404

### Wave 2 (next 1-2 days — full feature)

- **S04** — `producer_external_links` table + Setup UI + 7-platform embed components
- **S05** — Post-signup welcome splash + producer auto-attach refinement
- **S06** — Engagement approval flow (`artist.startEngagement` → Today notification → approve/decline → payment step)
- **S07** — QuickActions "Preview public page" URL updated

---

## Data model

### Migration 0030 — `is_public_sample` on portfolio tracks

```sql
ALTER TABLE "portfolio_tracks"
  ADD COLUMN IF NOT EXISTS "is_public_sample" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "portfolio_tracks_public_sample_idx"
  ON "portfolio_tracks" ("producer_id", "is_public_sample")
  WHERE "is_public_sample" = true;
```

Drizzle schema addition to `portfolio_tracks` table:
```ts
isPublicSample: boolean("is_public_sample").notNull().default(false),
```

### Migration 0031 — `producer_external_links` table (Wave 2)

```sql
CREATE TYPE "external_platform" AS ENUM (
  'spotify', 'apple_music', 'youtube', 'soundcloud',
  'bandcamp', 'tidal', 'instagram_reels'
);

CREATE TABLE IF NOT EXISTS "producer_external_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "producer_id" uuid NOT NULL REFERENCES "producers"("id") ON DELETE CASCADE,
  "platform" "external_platform" NOT NULL,
  "url" text NOT NULL,
  "title" text,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "producer_external_links_producer_idx"
  ON "producer_external_links" ("producer_id", "position");
```

---

## tRPC surface

### Wave 1

**Producer (authed):**
- `producer.portfolio.togglePublicSample({ trackId, enabled }): { ok: true }`
  - Auth: `producerProcedure` + owner check on track
  - Side effect: flips `is_public_sample` column

**Public (no auth):**
- `publicProfile.forJoin({ slug }): { producer, publicSamples, externalLinks }`
  - Returns minimal producer info (id, slug, displayName, bio, logo, brandColor)
  - Returns up to 3 public-sample tracks (filtered by `is_public_sample=true`, limit 3, ordered by `created_at desc`)
  - Returns external links in position order (empty array in Wave 1)
  - 404 via `TRPCError({ code: "NOT_FOUND" })` if slug doesn't match any producer
  - Strips everything sensitive — no `stripeCustomerId`, no email, no notes

### Wave 2

- `producer.externalLinks.{list, add, remove, reorder}` — producer-scoped CRUD
- `artist.startEngagement({ producerId, serviceId })` — creates pending project, inserts notification for producer
- `producer.engagement.{approve, decline}({ projectId })` — transitions project stage, triggers payment step

---

## UI components

### Wave 1

- `apps/web/src/app/(public)/join/[slug]/page.tsx` — server component
  - Fetches via `publicProfile.forJoin`
  - Renders `<JoinHero producer={...} />` + `<PublicSamplesPlayer tracks={...} />` + `<SignupCta slug={...} />`

- `apps/web/src/components/join/join-hero.tsx` — client component
  - Producer name + photo + bio
  - CSS vars only; follows landing page visual vocabulary

- `apps/web/src/components/join/public-samples-player.tsx` — client component
  - Reuses existing `WaveformPlayer` from `~/components/audio/waveform-player`
  - One player per public sample track
  - Empty state: "This producer hasn't shared any samples yet."

- `apps/web/src/components/join/signup-cta.tsx` — client component
  - Big button → Clerk `SignUpButton` with `redirectUrl` = `/artist-welcome/<slug>?first=true`

- `apps/web/src/components/dashboard/setup/portfolio-sample-toggle.tsx` — client
  - Per-track toggle inline in existing Setup → Portfolio tab
  - Optimistic update via `useOptimistic` + mutation

### Wave 2

- External links section in Portfolio Setup (add/remove/reorder)
- Embed components (one per platform) at `apps/web/src/components/embeds/{spotify,apple-music,youtube,soundcloud,bandcamp,tidal,instagram}.tsx`
- `artist-welcome/[slug]/page.tsx` — post-signup welcome
- Engagement approval card on Today

---

## Route changes

### Wave 1 — additions

- `apps/web/src/app/(public)/join/[slug]/page.tsx` — new

### Wave 1 — deletions

- `apps/web/src/app/(public)/p/[slug]/page.tsx` and its subtree (book/, share/, etc.)
- The whole `apps/web/src/app/(public)/p/` folder can go if nothing else lives under it

Audit before delete:
- Grep for any internal links that still point at `/p/<slug>` — update to `/join/<slug>`
- Search: `"/p/${`, `href="/p/`, `router.push("/p/`, `navigate("/p/`

### Wave 2 — additions

- `apps/web/src/app/(artist-welcome)/artist-welcome/[slug]/page.tsx` — already exists as welcome splash; extend to handle the `?first=true` case.

---

## Auth / signup flow

### Wave 1

- `/join/<slug>` is a public route
- "Sign up" button invokes Clerk's `<SignUpButton redirectUrl="/artist-welcome/<slug>?first=true" />`
- Existing Clerk webhook stamps `client_contacts.clerk_user_id` via email match
- **Wave 1 doesn't build the auto-attach-producer logic** — that's Wave 2. For tonight, post-signup just lands the user at the generic artist welcome.

### Wave 2

- New tRPC: `artist.attachStudio({ producerId })` — idempotent upsert on `client_contacts` creating a row with this producer+emailHash if none exists.
- Called from `/artist-welcome/[slug]` page on mount (post-signup).
- If already-has-account: show confirm modal before calling, per PRD §6.4.

---

## Test strategy

### Wave 1 (must pass before merging)

- Migration 0030 applied against local DB (via `/skitza-migrate`)
- tRPC: `publicProfile.forJoin` — auth scope (public), slug-not-found → 404, public sample filter honored, sensitive fields stripped
- tRPC: `producer.portfolio.togglePublicSample` — auth scope (producer owns track), persistence
- Route: hitting `/p/<any-slug>` returns 404
- Route: hitting `/join/<gili-slug>` renders the hero + samples + CTA

### Wave 2 adds

- External-links CRUD auth scoping (`findPredicate`)
- Engagement approval flow end-to-end
- URL parsing for each of 7 platforms (unit tests on parser functions)

---

## Deploy

- Migrations 0030 (and 0031 in Wave 2) run via `/skitza-migrate` before the Vercel deploy picks up the new code
- No env var changes required
- No Resend activation yet (Wave 2 is when signup emails fire)

---

## Risks + mitigations

- **`/p/<slug>` removal might break some in-app link**: grep sweep is a Dev story step. If found, update or delete.
- **`is_public_sample` migration on a table that doesn't exist yet**: check `portfolio_tracks` exists in prod. If not, the table needs to be created first (separate migration). Query DB before Wave 1 kickoff.
- **Wave 2's engagement-approval flow couples to Stripe Connect, which isn't live**: fallback to "Mark paid offline" per PRD §12.3. Wave 2 stories explicitly handle this.

---

## Subagent dispatch plan for Wave 1

Three Dev stories to dispatch tonight. They are **mostly parallel** — S02 can read from S01's migration output, so dispatch order matters slightly:

1. **S01** first (migration + producer UI toggle)
2. **S02** in parallel with **S03** once S01's migration is applied locally
3. QA subagent runs after each story

See `docs/plans/stories/join-01-public-sample-toggle.md` etc. for per-story detail.
