# Session Recap — Live Handoff State

> **READ THIS FIRST at the start of every session.** This file is a rolling snapshot of the current project state. It's overwritten at every checkpoint so it always reflects "right now." If you need history, `git log` this file.

---

## 🕐 Last checkpoint

**2026-04-23 mid-morning — observability stack verified live on prod. Migrations 0032 + 0033 applied to prod Postgres; Sentry + PostHog both receiving data; 6 Vercel env vars saved across all 3 environments. Next up: watch real-user data for a few days, then tackle remaining audit tasks (4, 9, 10, 17 phases 2+3).**

---

## ✅ What shipped today

### Code merged (6 PRs, all on `main`)

| PR | Audit # | Title | DB change |
|---|---|---|---|
| #32 | 14 | Sentry + PostHog observability | — |
| #34 | 11 | Quick Note modal → DB | Migration 0032 (`producer_notes` table) |
| #36 | 12 | Autopilot cron behaviors (2 of 3 live) | Migration 0033 (`reminder_sent_at` + `testimonial_requested_at` columns) |
| #33 | 13 | 8 Resend email templates | — |
| #35 | 8 | Auto-generated changelog | — |
| #37 | — | Audit docs + recap | — |

**Audit progression: 5 → 9 ✅ Fixed of 17 (53% closed).** Tests: 611 → 638 (+27).

### Ops done (hands-on-keyboard, post-merge)

- ✅ Migrations 0032 + 0033 applied to prod via `apply-migrations.mjs`
- ✅ Sentry account created + DSN + org/project slugs + auth token captured
- ✅ PostHog account created + Project API Key captured
- ✅ All 6 env vars set on Vercel (Production + Preview + Development)
- ✅ Prod redeploy triggered by env var save; Vercel picked them up
- ✅ `/ingest/decide` smoke test returned key-validation error from PostHog (proves proxy is wired)
- ✅ Real pageview visible in PostHog's Activity feed after incognito visit to skitza.app
- ⏸ GitHub Actions billing — **skipped**. Zero-cost plan chosen. Merge manually; rely on local `pnpm -F web test`. Auto-changelog workflow works when triggered locally too.
- ⏸ Vercel Pro upgrade — **skipped**. Autopilot cron is callable but not scheduled; manual curl works.

### Paper trail

- [`docs/qa/2026-04-23-overnight-prs-audit.md`](qa/2026-04-23-overnight-prs-audit.md) — pre-merge verification of the 5 overnight PRs
- [`docs/qa/2026-04-23-observability-verification.md`](qa/2026-04-23-observability-verification.md) — post-merge Sentry + PostHog verification
- [`docs/audit-report.md`](audit-report.md) — 17-task tracker, now showing 9 ✅ Fixed

---

## 📍 Current state

| Thing | State |
|---|---|
| **Active branch** | `main` (in sync with origin) |
| **HEAD** | `87da947` (after PR #37 merge) |
| **Open PRs** | #1, #16, #28, #29 (all pre-existing, not from overnight) |
| **Typecheck / Lint / Tests / Build** | ✅ all clean |
| **Tests** | 638 pass / 4 skipped / 0 fail |
| **Prod schema** | up to migration 0033 |
| **Sentry** | ✅ live, awaiting first error |
| **PostHog** | ✅ live, receiving pageviews + Clerk identity |
| **Autopilot cron** | deployed, **not scheduled** (Hobby tier) |
| **Audit status** | 9 ✅ Fixed · 7 ⏳ Pending · 1 ⏸ Partial (#17) |
| **Launch clock** | Day 3 of 12-week post-launch roadmap |

---

## 🟠 Known bugs still on main (quarantine list)

Now **diagnosable** with Sentry + PostHog live. No touching these files until we have ~1 week of real-user data:

1. `/sign-in` line 8: `forceRedirectUrl="/dashboard"` — ignores `redirect_url` query param
2. `/artist-welcome` (no slug): no role guard for authed users with real studios
3. Webhook race on `/artist-welcome/<slug>` — fast-clickers land on `/artist` before `client_contacts` row exists

**Files NOT to touch:**

- `apps/web/src/app/(auth)/sign-in/*`, `/sign-up/*`
- `apps/web/src/app/(artist)/artist/layout.tsx`
- `apps/web/src/app/(artist-welcome)/**/*`
- `apps/web/src/app/api/webhooks/clerk/**/*`

---

## 🎯 What's next (in priority order)

### This week — observe + validate

1. **Check PostHog's Activity tab daily** — 5 min each morning. Watch for drop-offs, hot paths, confused-user patterns.
2. **Check Sentry's Issues tab daily** — any new error gets triaged. Real stack traces finally exist.
3. **Watch at least 3 session replays** — PostHog records full browser sessions. Real producers using your app is a gut-check you've been missing.

### When Sentry has ~1 week of data

4. Diagnose + ship fixes for the 3 quarantined bugs (now backed by real traces)

### Remaining audit tasks (priority order)

5. **Task 4** — onboarding 4 → 5 steps (PRD §4.5 compliance — missing Portfolio + Stripe steps)
6. **Task 9** — kill `/dashboard/booking` (duplicates Setup, confusing UX)
7. **Task 10** — landing page TODO placeholders (credibility hit on cold visit)
8. **Task 3** — S04 UI (embed parsers + `/join` Section B render — already has backing from PR #28)
9. **Task 17 Phases 2+3** — artist desktop sidebar salvage (branch preserved, now Sentry-diagnosable)

### Parked (need Gili's input)

- **Task 5** — refund policy content
- **Task 6** — cookie banner (EU compliance)
- **Task 7** — Privacy + Terms (counsel review required)

---

## 🔧 Ops playbooks (learned this session)

### Apply migrations to prod (journal broken, use direct runner)

```bash
set -a && . apps/web/.env.local && set +a
node packages/db/apply-migrations.mjs
```

All migrations are `ADD COLUMN IF NOT EXISTS` or similar idempotent forms — safe to re-run. Output ends with `All migrations applied successfully.`

### Verify PostHog proxy is live without leaking a key

```bash
curl -s "https://skitza.app/ingest/decide?v=3" -H "Content-Type: application/json" -d '{"token":"dummy"}'
```

Expect: `The provided API key is invalid or has expired.` — that proves (1) proxy routes to PostHog, (2) PostHog validates keys. No secret required.

### Smoke-test autopilot cron on prod

```bash
# Get CRON_SECRET from Vercel env vars first (UI only)
curl -H "Authorization: Bearer <secret>" https://skitza.app/api/cron/autopilot
```

Expect JSON with `"ok":true` and zero counts (no 7/30-day-old rows yet).

### Merge a PR with `audit-report.md` conflict

Every PR touching `audit-report.md` will conflict with the next. Resolution pattern:

1. Checkout the branch, `git rebase origin/main`
2. Edit the conflict block: **keep both halves** of the status table (your row + main's row)
3. `git add docs/audit-report.md && git rebase --continue`
4. Re-verify gates (`pnpm -F web typecheck lint test`)
5. `git push --force-with-lease` + `gh pr merge --squash --delete-branch`

---

## 📋 Files to glance at if diving back in

- [`docs/qa/2026-04-23-observability-verification.md`](qa/2026-04-23-observability-verification.md) — how we proved Sentry + PostHog are live
- [`docs/qa/2026-04-23-overnight-prs-audit.md`](qa/2026-04-23-overnight-prs-audit.md) — pre-merge audit of the 5 overnight PRs
- [`docs/audit-report.md`](audit-report.md) — 17-task tracker (9 now ✅ Fixed)
- [`docs/plans/active/2026-04-22-overnight-execution-plan.md`](plans/active/2026-04-22-overnight-execution-plan.md) — the brief that drove the overnight run
- [`docs/plans/active/2026-04-21-post-launch-roadmap.md`](plans/active/2026-04-21-post-launch-roadmap.md) — 12-week plan
- [`docs/product/PRD.md`](product/PRD.md) — normative spec
- [`docs/INDEX.md`](INDEX.md) — master map

---

## 🔑 How to resume from cold

1. Read this file.
2. Read [CLAUDE.md](../CLAUDE.md) — auto-loaded.
3. `gh pr list --state open` — should show only #1, #16, #28, #29 (all pre-overnight).
4. Open PostHog Activity + Sentry Issues tabs — review the last 24h of real-user data before picking the next task.
5. Pick from the "What's next" list above.

---

## 🧹 Update discipline

**This file is overwritten, never appended.** Update at every natural checkpoint per `CLAUDE.md` § Session handoff protocol.
