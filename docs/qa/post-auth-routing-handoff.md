# Post-Auth Routing — Bulletproof Handoff

**Status:** PR open — `fix(auth): bulletproof post-auth routing` against `v3-clean`
**Branch:** `fix/bulletproof-post-auth-routing`
**Baseline before fix:** `v3-clean` tip `5336bec` — 994 passed / 4 skipped (998 total) across 94 test files; typecheck + lint clean.

This document records the two bugs being fixed, the architecture of the fix, the exact Clerk dashboard configuration Gili must set in the Clerk dashboard, and the verification steps Gili should run in a real browser before approving the merge.

## What was broken

### Bug A — slug signups landed on producer onboarding

Reproduction (pre-fix):
1. Sign up via `/join/<producer-slug>` (the artist self-serve link).
2. Clerk creates the user; the webhook at `/api/webhooks/clerk` correctly inserts a `client_contacts` row scoped to the producer (no producers row).
3. Clerk redirects the user to `/onboarding` instead of `/artist-welcome/<slug>`.
4. The producer onboarding wizard greets the artist; if they fill it out, they end up with a stray producers row that the role gate then has to interpret.

Root cause: Clerk's dashboard "After sign-up fallback" was set to `/onboarding`, which **overrides** the component-level `<SignUp fallbackRedirectUrl="/artist-welcome/<slug>">` in `apps/web/src/app/(public)/(auth)/sign-up/join/[slug]/[[...rest]]/page.tsx`. Component-level `fallbackRedirectUrl` is unreliable when a dashboard fallback exists — Clerk applies the dashboard value first.

### Bug B — every sign-in flashed through producer dashboard

Reproduction (pre-fix):
1. Sign in as an artist at `/sign-in`.
2. Clerk lands the user on `/dashboard` (the producer dashboard).
3. The `(producer)/layout.tsx` role gate detects the user is an artist, redirects to `/artist`.
4. The flash is visible on slow connections.

Root cause: `apps/web/src/app/(public)/(auth)/sign-in/[[...sign-in]]/page.tsx` set `forceRedirectUrl="/dashboard"`. `forceRedirectUrl` overrides every other redirect signal including `redirect_url` query params and the dashboard fallback. So the role-gate bounce was the only correction mechanism.

## Architecture of the fix

Two new server-component pages own all post-auth routing decisions:

- [`apps/web/src/app/(post-auth)/post-signup/page.tsx`](../../apps/web/src/app/(post-auth)/post-signup/page.tsx) — handles every sign-up, branches on `currentUser().unsafeMetadata` to send join-flow artists to `/artist-welcome/<slug>` and everyone else to `/post-signin` for role resolution.
- [`apps/web/src/app/(post-auth)/post-signin/page.tsx`](../../apps/web/src/app/(post-auth)/post-signin/page.tsx) — handles every sign-in, calls [`fetchUserRole`](../../apps/web/src/server/auth/role.ts) and routes by role: `/dashboard`, `/onboarding`, `/artist`, or — for orphans — `/sign-in?error=account_setup_incomplete` plus a Sentry error event.

The component-level `forceRedirectUrl` / `fallbackRedirectUrl` props on `<SignIn>` and `<SignUp>` are removed entirely. The Clerk dashboard's "After sign-in fallback" / "After sign-up fallback" become the single source of truth for the post-auth landing page, and the dashboard is set to point at the new router pages.

`unsafeMetadata={{ signupOrigin: "join", producerSlug: slug }}` is **kept** on `/sign-up/join/<slug>/page.tsx` — `/post-signup` reads it via `currentUser()` (the metadata isn't in the default Clerk session JWT, but it does ride on the User object) and validates the slug against the DB before trusting it.

### Why no polling

`/post-signin` deliberately does **not** poll for the orphan case. Sign-in users have, by definition, signed up before — their webhook has already run, their `producers` or `client_contacts` row exists. An orphan classification at sign-in means the original sign-up webhook silently failed, which is a production bug, not a polite race window. The fix surfaces it via Sentry (`captureMessage` at error level) and routes the user to `/sign-in?error=account_setup_incomplete` so they can re-attempt or contact support.

`/post-signup` doesn't need polling either — `unsafeMetadata` is set by the `<SignUp>` mount before Clerk creates the user, so it's always present when the redirect lands. The producer slug it references points at a stable, pre-existing row, not a row the just-fired webhook needs to create.

## REQUIRED Clerk dashboard changes (Gili — do this before merging)

In the [Clerk dashboard](https://dashboard.clerk.com/) for the Skitza application, set:

| Setting | Path | New value |
|---|---|---|
| **After sign-up fallback** | Configure → **Paths** → After sign-up | `/post-signup` |
| **After sign-in fallback** | Configure → **Paths** → After sign-in | `/post-signin` |

Apply the same settings in **both** the Production instance and the Development instance (so Vercel preview deployments use the new flow).

After saving:

1. Test in a real browser at `http://localhost:3000` (Claude's preview pane can't follow Clerk redirects; this is a known Clerk limitation, not a Skitza bug):
   - Sign up via `/join/<your-slug>` with a fresh email → should land on `/artist-welcome/<slug>` (greeting page) → click through to `/artist`.
   - Sign up via `/sign-up` (no slug) with a fresh email → should land on `/post-signup` briefly → `/post-signin` → `/onboarding` (because the user is producer-incomplete).
   - Sign in as an existing artist at `/sign-in` → should go straight to `/artist` with no `/dashboard` flash.
   - Sign in as an existing producer at `/sign-in` → should go straight to `/dashboard` with no flash.
2. Verify in the Vercel preview URL (same flows).

## What changed in the codebase

| File | Change |
|---|---|
| `apps/web/src/app/(post-auth)/post-signup/page.tsx` | NEW — server-component router; reads `currentUser().unsafeMetadata`, validates slug regex + DB, branches to `/artist-welcome/<slug>` or `/post-signin`. Sentry breadcrumb on the join branch. |
| `apps/web/src/app/(post-auth)/post-signin/page.tsx` | NEW — server-component router; reads `auth()` + `fetchUserRole()`, branches to `/dashboard` / `/onboarding` / `/artist` / `/sign-in?error=...`. Sentry `captureMessage` on the orphan branch. |
| `apps/web/src/app/(post-auth)/post-signup/__tests__/page.test.ts` | NEW — 4 cases: join+valid, join+tampered, non-join, no user. |
| `apps/web/src/app/(post-auth)/post-signin/__tests__/page.test.ts` | NEW — 5 cases: each of the 5 role kinds. |
| `apps/web/src/app/(public)/(auth)/sign-up/[[...sign-up]]/page.tsx` | Removed `fallbackRedirectUrl="/dashboard"` — dashboard config is now the source of truth. |
| `apps/web/src/app/(public)/(auth)/sign-up/join/[slug]/[[...rest]]/page.tsx` | Removed `fallbackRedirectUrl={...}`. KEPT `unsafeMetadata={{ signupOrigin, producerSlug }}` — `/post-signup` reads it. |
| `apps/web/src/app/(public)/(auth)/sign-in/[[...sign-in]]/page.tsx` | Removed BOTH `forceRedirectUrl` and `fallbackRedirectUrl`. |

No webhook changes. No DB schema changes. No new dependencies. No producer / artist / landing page touched.

## Tests

`/post-signup` — 4 cases:
1. join origin + valid slug + DB hit → `/artist-welcome/<slug>` + Sentry breadcrumb
2. join origin + tampered slug (regex fail) → `/post-signin`, NO DB hit, NO breadcrumb
3. non-join origin (no metadata) → `/post-signin`, NO DB hit
4. no current user → `/sign-in`

`/post-signin` — 5 cases:
1. unauthenticated (no userId) → `/sign-in`
2. producer-complete → `/dashboard`
3. producer-incomplete → `/onboarding`
4. artist → `/artist`
5. orphan → `/sign-in?error=account_setup_incomplete` + `Sentry.captureMessage` at error level

Webhook test (`apps/web/src/app/api/webhooks/clerk/route.ts`) and the existing role test continue to pass — no logic change there.

## Rollback plan

If the new routing causes problems:

1. Revert this PR (`git revert <merge-sha>`).
2. In the Clerk dashboard, change "After sign-up fallback" back to whatever it was previously (probably `/onboarding`) and "After sign-in fallback" back to `/dashboard`.
3. The previous component-level `forceRedirectUrl` / `fallbackRedirectUrl` props are restored by the revert, so behavior matches what was on `v3-clean` before the fix.

The fix is observable through Sentry — any orphan-on-signin event after merge is the early signal that the centralized routing has caught a previously-silent webhook failure.
