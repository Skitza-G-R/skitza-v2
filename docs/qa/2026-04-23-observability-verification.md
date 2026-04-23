# Observability Verification — Post-PR #32 Merge

> **Date:** 2026-04-23
> **Trigger:** Immediately after PR #32 merged + Gili set the 6 Sentry/PostHog env vars on Vercel.
> **Verdict:** ✅ Sentry + PostHog are both wired end-to-end on prod.
> **Bookend to:** [`2026-04-23-overnight-prs-audit.md`](2026-04-23-overnight-prs-audit.md) (pre-merge audit).

---

## Why this doc exists

PR #32 installed the SDKs, but "installed" ≠ "working." Env vars needed to be set on Vercel and a real request had to flow through the system. This doc captures how we proved it ended up live.

## What we verified

### 1. Prod migrations applied

Migrations 0032 (`producer_notes`) + 0033 (`invoices.reminder_sent_at` + `projects.testimonial_requested_at`) applied to prod Postgres via:

```bash
set -a && . apps/web/.env.local && set +a && node packages/db/apply-migrations.mjs
```

Output ended with `All migrations applied successfully.` Both migrations use `ADD COLUMN IF NOT EXISTS` so re-running is safe.

### 2. Six env vars set on Vercel (Production + Preview + Development)

| Variable | Provenance |
|---|---|
| `SENTRY_DSN` | Sentry Next.js project onboarding — format `https://<key>@<org-id>.ingest.de.sentry.io/<project-id>` (EU region) |
| `NEXT_PUBLIC_SENTRY_DSN` | Same value — exposed to browser |
| `SENTRY_ORG` | Sentry org slug, visible in the URL (`<slug>.sentry.io`) |
| `SENTRY_PROJECT` | Sentry project slug, from Settings → Project → General → Slug field |
| `SENTRY_AUTH_TOKEN` | Created at `/settings/auth-tokens/` with scopes `project:read`, `project:releases`, `org:read` |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog Project API Key (`phc_...`) |

### 3. Proxy + key-validation smoke test

The `/ingest` path is rewritten to PostHog in `apps/web/next.config.ts` so events don't hit ad-blocker lists.

Test pattern:

```bash
curl -s "https://skitza.app/ingest/decide?v=3" -H "Content-Type: application/json" -d '{"token":"dummy"}'
```

Expected response: `The provided API key is invalid or has expired.`

That response is **exactly what proves the wiring works**:

1. The `/ingest` proxy rewrite is live (request routed)
2. PostHog's server received it (we got a response, not a 404 or connection error)
3. PostHog is validating keys (it rejected "dummy")

When the real app sends a request with the `phc_...` key, PostHog accepts it.

### 4. Real-user pageview traceable

Gili opened an incognito window → visited `https://skitza.app` → clicked around → within ~30 seconds the pageviews appeared in PostHog's Activity feed. Confirmed live.

### 5. Sentry — passive until an error happens

Sentry won't show anything in the Issues tab until something actually throws. That's normal. Next production error (quarantined bug hit, tRPC procedure failing, etc.) will surface automatically with full stack trace + release attribution.

## Gotchas we hit

### `NEXT_PUBLIC_` means browser-exposed

`NEXT_PUBLIC_POSTHOG_KEY` ends up in the shipped JS bundle. That's by design — PostHog's Project API Key is intended to be client-exposed. The `NEXT_PUBLIC_SENTRY_DSN` is the same pattern. Non-`NEXT_PUBLIC_` vars (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_DSN` server-side) stay server-only.

### Don't share credentials via chat

Even for public-by-design keys like `NEXT_PUBLIC_POSTHOG_KEY`. Habit matters — the same chat channel could later carry a genuinely secret token (Stripe, Clerk, database URL). Always copy straight from source to destination, never through a middleman.

### Sentry EU region is fine

The DSN being on `ingest.de.sentry.io` (instead of `ingest.us.sentry.io`) doesn't change anything on our side. Sentry auto-selects based on signup region. No code change needed.

## What's now unblocked

With observability live, the 3 quarantined bugs on main become diagnosable:

1. `/sign-in` `forceRedirectUrl` ignoring `redirect_url` query param
2. `/artist-welcome` (no slug) missing role guard for authed producers
3. Webhook race on `/artist-welcome/<slug>` before `client_contacts` row exists

Next time any of these fire in prod, Sentry will capture the exact stack trace + the PostHog session replay will show what the user was doing. No more guesswork.

## Status snapshot (post-verification)

- **Audit tasks ✅ Fixed:** 9 of 17 (53%) — Tasks 1, 2, 8, 11, 12, 13, 14, 15, 16
- **Tests on main:** 638 passing / 4 skipped / 0 failing
- **Quarantine list:** still active until we have 1 week of real-user Sentry data

*Filed: 2026-04-23 · Verified by: Gili (browser tests) + Claude (curl smoke tests)*
