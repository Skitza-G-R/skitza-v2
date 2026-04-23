# Session Recap — Live Handoff State

> **READ THIS FIRST at the start of every session.** This file is a rolling snapshot of the current project state. It's overwritten at every checkpoint so it always reflects "right now." If you need history, `git log` this file.

---

## 🕐 Last checkpoint

**2026-04-23 — All 5 overnight PRs (#32-36) merged into main. Final main verified: typecheck ✅ · lint ✅ · 638 tests pass / 4 skip · 0 fail. Pre-merge audit at [`docs/qa/2026-04-23-overnight-prs-audit.md`](qa/2026-04-23-overnight-prs-audit.md) confirmed everything green; sequential merge handled the audit-report.md cascading conflicts cleanly.**

---

## ✅ What landed today on main

| PR | Audit # | Title | Net change |
|---|---|---|---|
| #32 | 14 | Sentry + PostHog observability | +instrumentation, 6 env vars to set |
| #34 | 11 | Quick Note modal → DB | +producer_notes table (migration 0032) |
| #36 | 12 | Autopilot cron behaviors | +reminder_sent_at + testimonial_requested_at columns (migration 0033); 2 of 3 behaviors live |
| #33 | 13 | 8 Resend email templates | +9 smoke tests, dispatchers wired |
| #35 | 8 | Auto-generated changelog | +148 entries, GitHub workflow opens PR on demand |

**Audit progression: 5 → 9 ✅ Fixed of 17 (53% closed).** Test count: 611 → 638 (+27).

---

## 🚨 ACTION ITEMS — must do before features go live

### 1. Apply migrations 0032 + 0033 to PROD

```bash
# From repo root:
set -a && . apps/web/.env.local && set +a
node packages/db/apply-migrations.mjs
```

(Both migrations are `ADD COLUMN IF NOT EXISTS` — idempotent and safe to re-run.)

### 2. Add 6 env vars to Vercel PROD

Otherwise Sentry + PostHog no-op (the install is non-fatal — preview builds prove it; you just won't see events). See `apps/web/.env.example`:

- `SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_AUTH_TOKEN` (build-time, for source-map upload)
- `NEXT_PUBLIC_POSTHOG_KEY`

### 3. Fix GitHub Actions billing block

Annotation on every PR's CI: *"recent account payments have failed or your spending limit needs to be increased."* Vercel still works; GitHub workflows (including the new auto-changelog) won't run until billing's resolved.

### 4. (Eventually) upgrade to Vercel Pro to schedule autopilot cron

One-line add to `vercel.json`:

```json
{ "path": "/api/cron/autopilot", "schedule": "0 */6 * * *" }
```

Until then, smoke-test manually on prod:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://skitza.app/api/cron/autopilot
```

---

## 🟠 Known bugs still on main (quarantine list — unchanged)

PR #32 (Sentry) is now merged → you can finally diagnose these with real logs:

1. `/sign-in` line 8: `forceRedirectUrl="/dashboard"` — ignores `redirect_url` query param
2. `/artist-welcome` (no slug) renders orphan copy even for authed users with real studios
3. Webhook race on `/artist-welcome/<slug>` — fast-clickers can land on `/artist` before `client_contacts` exists

**Quarantine still active until Sentry env vars are set + you've reviewed the data.** Files NOT to touch:

- `apps/web/src/app/(auth)/sign-in/*`, `/sign-up/*`
- `apps/web/src/app/(artist)/artist/layout.tsx`
- `apps/web/src/app/(artist-welcome)/**/*`
- `apps/web/src/app/api/webhooks/clerk/**/*`

---

## 📍 Current state

| Thing | State |
|---|---|
| **Active branch** | `main` (clean working tree, 2 docs commits ahead of origin) |
| **HEAD** | `0ce9a80` on origin (after #35 merge) + 2 local docs commits |
| **Open PRs** | #1, #16, #28, #29 (all pre-existing, not from overnight) |
| **Typecheck** | ✅ |
| **Lint** | ✅ |
| **Tests** | ✅ 638 pass / 4 skipped / 0 fail |
| **Build** | ✅ |
| **Audit status** | 9 ✅ Fixed (Tasks 1, 2, 8, 11, 12, 13, 14, 15, 16) · 7 ⏳ Pending · 1 ⏸ Partial (#17) |
| **Launch clock** | Day 3 of 12-week post-launch roadmap |

---

## 🧠 What's next (in priority order)

**This week — operational follow-through:**

1. Apply migrations 0032 + 0033 to prod (action item #1 above)
2. Set Sentry/PostHog env vars on Vercel (action item #2)
3. Fix GitHub Actions billing (action item #3)
4. Manually QA the 4 newly-shipped surfaces on prod:
   - Quick Note save → reload → still there
   - Curl autopilot endpoint → expected JSON shape
   - `/changelog` page renders "Recent changes" section
   - Throw a test error in dev → confirm Sentry receives it

**Once observability is producing data (probably this weekend):**

5. Diagnose the 3 quarantined bugs above and ship fixes
6. Tackle remaining audit tasks in this priority order:
   - **Task 4** (onboarding 5-step) — PRD §4.5 compliance
   - **Task 9** (kill /dashboard/booking) — duplicates Setup, confuses UX
   - **Task 10** (landing TODO placeholders) — credibility hit
   - **Task 3** (S04 UI) + open PR #28 already has the embed parser
   - **Task 17 Phases 2+3** (artist desktop sidebar) — branch preserved, salvage post-Sentry

**Parked for input from you (legal / strategic):**

- Task 5 (refund policy content)
- Task 6 (cookie banner — EU compliance)
- Task 7 (Privacy + Terms — needs counsel review)

---

## 📋 Files to glance at if diving back in

- [`docs/qa/2026-04-23-overnight-prs-audit.md`](qa/2026-04-23-overnight-prs-audit.md) — **this morning's pre-merge audit** (the verification work behind the 5 merges)
- [`docs/audit-report.md`](audit-report.md) — 17-task tracker (9 now ✅ Fixed)
- [`docs/plans/active/2026-04-22-overnight-execution-plan.md`](plans/active/2026-04-22-overnight-execution-plan.md) — the brief that drove last night's run
- [`docs/plans/active/2026-04-21-post-launch-roadmap.md`](plans/active/2026-04-21-post-launch-roadmap.md) — 12-week plan
- [`docs/product/PRD.md`](product/PRD.md) — normative spec
- [`docs/INDEX.md`](INDEX.md) — master map

---

## 🔑 How to resume from cold

1. Read this file.
2. Read [CLAUDE.md](../CLAUDE.md) — auto-loaded.
3. Read [`docs/qa/2026-04-23-overnight-prs-audit.md`](qa/2026-04-23-overnight-prs-audit.md) for full per-PR detail.
4. `gh pr list --state open` — should show only #1, #16, #28, #29.
5. Pick from the "What's next" list above based on what surfaces you've already QA'd on prod.

---

## 🧹 Update discipline

**This file is overwritten, never appended.** Update at every natural checkpoint per `CLAUDE.md` § Session handoff protocol.
