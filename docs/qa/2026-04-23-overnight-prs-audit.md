# Pre-merge Audit — Overnight PRs #32–36 + Codebase Health Check

> **Date:** 2026-04-23
> **Author:** Claude (autonomous audit)
> **Trigger:** Gili asked for a verification + state-of-the-app report before merging the 5 overnight PRs.
> **Scope:** Two parts — (1) per-PR verification, (2) codebase + plan/roadmap variance.

---

## TL;DR — recommendation

✅ **All 5 PRs are safe to merge** (typecheck + lint + 611-621 tests + production build all clean on every branch tip; quarantined files untouched; plumbing claims all verified).

⚠️ **Two operational gotchas before/after merge:**

1. **GitHub Actions CI is red on all 5 PRs because of a billing problem on your GitHub account, not a code problem.** The test job never started — annotation reads *"recent account payments have failed or your spending limit needs to be increased."* Vercel preview built clean on every PR, which proves the code compiles in a fresh env. Fix the billing then re-run, or merge manually.
2. **Sequential merges will cascade conflicts on `docs/audit-report.md`** (every PR appends a row + fix-log entry to that file). Plan: merge in the recommended order, resolve the audit-report conflict on each subsequent PR by accepting both sets of changes (manual conflict resolution).

After merge:
- Run `/skitza-migrate` against prod for migrations 0032 + 0033
- Add Sentry/PostHog env vars to Vercel (see `apps/web/.env.example`)
- Cron stays manual until you upgrade to Vercel Pro

---

## Part 1 — Per-PR verification

For each PR I checked out the branch tip locally, ran the full gate (typecheck + lint + tests + production build), and spot-checked the actual code against the PR's claims. Results below.

### PR #32 — Sentry + PostHog observability (audit Task 14)

| Check | Result |
|---|---|
| Branch | `feat/task-14-observability` |
| Mergeable | ✅ MERGEABLE |
| Diff size | +2429 / -64 |
| Typecheck | ✅ clean |
| Lint | ✅ clean |
| Tests | ✅ 611 pass / 4 skipped (no new tests — pure infra) |
| Build | ✅ clean |
| GitHub CI | ❌ **billing block** (not a code issue) |
| Vercel preview | ✅ deployed |
| Quarantined files touched | None ✅ |

**Files (12):**
- `apps/web/sentry.{client,server,edge}.config.ts` — 3 runtime configs
- `apps/web/instrumentation.ts` — Next 15 hook
- `apps/web/next.config.ts` — wrapped with `withSentryConfig` + `/ingest` PostHog proxy rewrite
- `apps/web/src/app/layout.tsx` — PostHogProvider mounted inside ClerkProvider
- `apps/web/src/components/observability/posthog-provider.tsx` — manual `$pageview` + Clerk identify/reset
- `apps/web/.env.example` — 6 new env vars documented
- `apps/web/tsconfig.json` — added new root-level configs to `include`
- `apps/web/package.json` + `pnpm-lock.yaml` — `@sentry/nextjs` + `posthog-js`
- `docs/audit-report.md` — Task 14 → ✅ Fixed

**Claims spot-checked:**
- ✅ DSN-optional init (Sentry no-ops if envs missing — preview builds prove this)
- ✅ Clerk `useUser` identify in PostHog provider (verified file shape)
- ✅ `@sentry/nextjs` is a real dep in `package.json`

**Reviewer focus:**
1. **Add 6 env vars to Vercel prod before merge or this is a no-op:** `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `NEXT_PUBLIC_POSTHOG_KEY`.
2. Sentry source-map upload requires `SENTRY_AUTH_TOKEN` at build time. Without it, Sentry still works but stack traces are minified.

---

### PR #33 — 8 missing Resend email templates (audit Task 13)

| Check | Result |
|---|---|
| Branch | `feat/task-13-email-templates` |
| Mergeable | ✅ MERGEABLE |
| Diff size | +1229 / -1 |
| Typecheck | ✅ clean |
| Lint | ✅ clean |
| Tests | ✅ 620 pass / 4 skipped (+9 smoke render tests) |
| Build | ✅ clean |
| Quarantined files touched | None ✅ |

**Templates added (8):**
1. `contract-ready.tsx`
2. `final-payment-due.tsx`
3. `track-version-uploaded.tsx`
4. `producer-replied-to-comment.tsx`
5. `payment-received.tsx`
6. `new-comment-from-artist.tsx`
7. `contract-signed.tsx`
8. `booking-cancelled-or-rescheduled.tsx`

Plus 8 `sendXxxEmail` dispatchers in `send.tsx` and 9 smoke tests (each template + send.tsx).

**Claims spot-checked:**
- ✅ Existing 4 templates on main (`booking-confirmed-to-artist`, `booking-request-received`, `session-reminder-1h/24h`) → +8 = 12, matches PRD §14
- ✅ All templates follow the warm-cream/Georgia-heading pattern of the existing 4

**Reviewer focus:**
- Smoke tests only verify the templates *render*. They don't QA copy. To validate copy, send each template to yourself before turning the production triggers on (most aren't wired to triggers yet — they're stockpiled for the wave-by-wave trigger work coming up).

---

### PR #34 — Quick Note modal → DB (audit Task 11)

| Check | Result |
|---|---|
| Branch | `feat/task-11-quick-note-db` |
| Mergeable | ✅ MERGEABLE |
| Diff size | +462 / -28 |
| Typecheck | ✅ clean |
| Lint | ✅ clean |
| Tests | ✅ 619 pass / 4 skipped (+8 producer-notes tests) |
| Build | ✅ clean |
| Quarantined files touched | None ✅ |

**Files:**
- `packages/db/drizzle/0032_producer_notes.sql` — idempotent migration, partial `(producer_id, created_at desc)` index
- `packages/db/src/schema.ts` — `producerNotes` pgTable + types
- `apps/web/src/server/trpc/routers/producer-notes.ts` — `producerNotesRouter` (list / save / delete)
- `apps/web/src/server/trpc/routers/_app.ts` — `producerNotes` namespace wired
- `apps/web/src/app/(app)/dashboard/quick-note-actions.ts` — server actions via `appRouter.createCaller`
- `apps/web/src/components/dashboard/today/quick-actions.tsx` — `QuickNoteModal` swapped from localStorage to `useTransition` + `saveQuickNote`
- `apps/web/src/server/trpc/routers/__tests__/producer-notes.test.ts` — 8 tests

**Claims spot-checked (read the actual diff):**
- ✅ `producerProcedure` injects `ctx.db` AND `ctx.producerId` (verified `apps/web/src/server/trpc/producer-procedure.ts:25` returns `{ ...ctx, producerId, db }`)
- ✅ List query scopes `WHERE producer_id = ctx.producerId` ✓
- ✅ Save inserts with `producerId: ctx.producerId` ✓
- ✅ Delete uses **double-predicate** (`and(eq(id, input.id), eq(producerId, ctx.producerId))`) — claim verified, cross-tenant deletion blocked ✓

**Reviewer focus:**
- Open dashboard on preview → click the Quick Note icon → type + save → refresh page. Should persist. (Pre-merge it's localStorage; post-merge it's `producer_notes` rows.)
- Migration 0032 already applied to dev. Run `/skitza-migrate` against prod after merge.

---

### PR #35 — Auto-generated changelog (audit Task 8)

| Check | Result |
|---|---|
| Branch | `feat/task-8-auto-changelog` |
| Mergeable | ✅ MERGEABLE |
| Diff size | +1249 / -10 |
| Typecheck | ✅ clean |
| Lint | ✅ clean |
| Tests | ✅ 611 pass / 4 skipped (no new tests — script + workflow only) |
| Build | ✅ clean |
| Quarantined files touched | None ✅ |

**Files:**
- `apps/web/scripts/generate-changelog.mjs` — parses `git log main --no-merges -500` via `execFileSync` (no shell interpretation), filters `feat:`/`perf:`/`fix:`, emits JSON
- `apps/web/src/app/(public)/changelog/entries.generated.json` — 148 items on first run (committed output)
- `apps/web/src/app/(public)/changelog/page.tsx` — adds "Recent changes" section (auto) alongside "Major releases" (hand-curated)
- `apps/web/package.json` — `"changelog:regen": "node scripts/generate-changelog.mjs"`
- `.github/workflows/changelog-update.yml` — `workflow_dispatch` opens PR via `peter-evans/create-pull-request@v6`

**Reviewer focus:**
- After merge, trigger the workflow manually on GitHub Actions to confirm the PR-open flow works end-to-end (it'll auto-rerun any time you ship a `feat:` commit — but the schedule is on-demand, not cron, so you control the cadence).
- The workflow has no user inputs (security: hardened against title injection per the security hook's earlier flag).

---

### PR #36 — Autopilot cron 1+3 wired, 2 deferred (audit Task 12)

| Check | Result |
|---|---|
| Branch | `feat/task-12-autopilot-cron` |
| Mergeable | ✅ MERGEABLE |
| Diff size | +553 / -62 |
| Typecheck | ✅ clean |
| Lint | ✅ clean |
| Tests | ✅ 621 pass / 4 skipped (+10 cron tests) |
| Build | ✅ clean |
| Quarantined files touched | None ✅ |

**Files:**
- `packages/db/drizzle/0033_autopilot_idempotency.sql` — `ADD COLUMN IF NOT EXISTS` for `invoices.reminder_sent_at` + `projects.testimonial_requested_at`
- `packages/db/src/schema.ts` — added both columns
- `packages/db/src/index.ts` — added `gt, lt` to drizzle re-exports (was missing)
- `apps/web/src/app/api/cron/autopilot/route.ts` — full rewrite, 3 behaviors
- `apps/web/src/app/api/cron/autopilot/route.test.ts` — 10 tests

**Behaviors actually wired:**

| Behavior | Status | Why |
|---|---|---|
| `unpaid-reminder` | ✅ Live | SELECT older-than-7d unpaid invoices → Resend email → stamp `reminder_sent_at` for idempotency. Per-row try/catch so one Resend failure doesn't block the sweep. |
| `request-testimonial` | 🟡 **Detect-only** | Returns count of eligible projects in `requestTestimonial.eligible`. Email + DB stamp gate on the `/t/<token>` capture form (not yet built). Emailing a dead link would be worse than silence. |
| `auto-archive` | ✅ Live | `UPDATE projects SET stage='archived' … WHERE stage='paid' AND updated_at < (now - 30d)` — pure SQL, returns the affected count. |

**Claims spot-checked:**
- ✅ Migration 0033 adds the two timestamp columns idempotently
- ✅ Route does have all 3 sweeps in fixed order (unpaid → testimonial → archive)
- ✅ Tests cover auth/env guards (4), empty-DB happy path (1), unpaid sweep (3 — happy/null-email/error), testimonial detect-only (1), auto-archive count (1) = 10 ✓

**Reviewer focus:**
1. **Not yet scheduled in `vercel.json`** — Hobby tier caps daily crons at 1, slot belongs to `session-reminders`. To enable: add `{ "path": "/api/cron/autopilot", "schedule": "0 */6 * * *" }` to `vercel.json` *after* upgrading to Pro.
2. **Manual smoke test before scheduling:** curl the endpoint with your `CRON_SECRET` on preview and confirm JSON shape: `{ ok, ranAt, unpaidReminder, requestTestimonial, autoArchive }`.
3. **Auto-archive is the riskiest of the three** — it mutates `projects.stage`. Mitigations: only acts on 30+ day old `paid` rows of producers who opted in, and stage is reversible via the dropdown.

---

## Part 2 — Codebase + plan/roadmap variance

### Audit-task progression

Pre-overnight (on main today): **5 ✅ Fixed / 12 ⏳ Pending / 17 total**.
Post-merge of all 5 PRs: **9 ✅ Fixed / 8 ⏳ Pending / 17 total** = **53% closed**.

| # | Task | Severity | Pre-overnight | After PRs | PR |
|---|---|---|---|---|---|
| 1 | `/join/<slug>` crashes | 🔴 | ✅ Fixed | ✅ Fixed | (PR #30) |
| 2 | `forJoin` no error handling | 🔴 | ✅ Fixed | ✅ Fixed | (PR #30) |
| 3 | S04 backend dead code | 🔴 | ⏳ Pending | ⏳ Pending | (skipped — Task F) |
| 4 | Onboarding 4 vs 5-step | 🟠 | ⏳ Pending | ⏳ Pending | — |
| 5 | `/refund-policy` missing | 🟠 | ⏳ Pending | ⏳ Pending | — |
| 6 | No cookie banner | 🟠 | ⏳ Pending | ⏳ Pending | — |
| 7 | Privacy + Terms placeholder | 🟠 | ⏳ Pending | ⏳ Pending | — |
| 8 | Hand-seeded changelog | 🟠 | ⏳ Pending | **✅ Fixed** | **PR #35** |
| 9 | `/dashboard/booking` duplicates Setup | 🟠 | ⏳ Pending | ⏳ Pending | — |
| 10 | Landing TODOs | 🟡 | ⏳ Pending | ⏳ Pending | — |
| 11 | Quick Note localStorage | 🟡 | ⏳ Pending | **✅ Fixed** | **PR #34** |
| 12 | Autopilot cron 95% TODO | 🟡 | ⏳ Pending | **✅ Fixed (2/3)** | **PR #36** |
| 13 | Only 4 of 10 emails | 🟢 | ⏳ Pending | **✅ Fixed** | **PR #33** |
| 14 | No Sentry + PostHog | 🟢 | ⏳ Pending | **✅ Fixed** | **PR #32** |
| 15 | `/join` signup as Producer | 🔴 | ✅ Fixed | ✅ Fixed | (PR #30) |
| 16 | Artist role not isolated | 🔴 | ✅ Fixed | ✅ Fixed | (PR #30) |
| 17 | Artist UI missing UserButton | 🟠 | ⏸ Phase 1 only | ⏸ Phase 1 only | (PR #30) |

### Variance vs the overnight plan

The overnight plan (`docs/plans/active/2026-04-22-overnight-execution-plan.md`) listed 6 tasks (A-F) with a 5-PR cap. **Delivered 5 of 6 as planned**:

- **Task A (audit #14, Sentry+PostHog)** — shipped as PR #32 ✅
- **Task B (audit #13, 8 emails)** — shipped as PR #33 ✅
- **Task C (audit #11, Quick Note)** — shipped as PR #34 ✅
- **Task D (audit #8, changelog)** — shipped as PR #35 ✅
- **Task E (audit #12, autopilot)** — shipped as PR #36 ✅ (with 1 of 3 behaviors deferred behind a missing capture form, not a regression — explicitly called out in the plan)
- **Task F (audit #3, S04 UI)** — skipped per the 5-PR review-bandwidth cap. **No regression** — Task 3 was ⏳ Pending pre-overnight and remains so.

### Variance vs the 12-week roadmap

The post-launch roadmap (`docs/plans/active/2026-04-21-post-launch-roadmap.md`) bands work into 12 sprints. The overnight run knocked out items from **S2.3 (Sentry/PostHog), S5.5 (changelog automation), and the Autopilot/Email backlog from S5/S6**. Net effect:

- **S2 sprint pull-ins:** S2.3 (observability) — usually parked for week 3, landing now as a side-effect of the artist-welcome diagnostic crisis.
- **S5 sprint pull-ins:** S5.5 (changelog) + the email template stockpile from S5.x — pulled forward.
- **Autopilot:** PRD §13 listed Autopilot as a v1 feature; this PR moves it from "toggles exist but don't fire" to "2 of 3 actually fire," reducing the risk of producers feeling the toggle is fake.

**No deviations** from the roadmap's *intent* — all tasks were on the list, just pulled forward in priority because of the observability emergency.

### Pre-existing issues (not caused by overnight work, but flagged here for completeness)

1. **Migration 0029 missing from main** — sequential gap between 0028 and 0030. PR #16 (still open) holds the `consolidate deals → projects` migration that fills the gap. This pre-dates overnight and doesn't block overnight merges, but should be resolved before adding 0034+.
2. **Migration journal still broken past 0028** — `_journal.json` already misses 0030 + 0031 on main; my 0032 + 0033 will also be missing. Continue using `node packages/db/apply-migrations.mjs` for now.
3. **Known bugs on main (quarantined for Sentry-data diagnosis):**
   - `/sign-in` line 8: `forceRedirectUrl="/dashboard"` — confirmed still on main, ignores `redirect_url` query param
   - `/artist-welcome` (no slug): no role guard for authed-with-studios users
   - Webhook race on `/artist-welcome/<slug>`
   - **PR #32 (Sentry) unblocks diagnosing all three.**
4. **Other open PRs:** #1 (Node bump), #16 (migration 0029), #28 (S04 Part 2 UI), #29 (recap doc) — all pre-date overnight.

### Crucial-flow spot-check (read main, not PRs)

| Flow | File | Health |
|---|---|---|
| `/join/<slug>` | `apps/web/src/server/trpc/routers/public-profile.ts` | ✅ try/catch wrapped (Task 2 fix preserved) |
| Artist role isolation | `apps/web/src/server/auth/role.ts` | ✅ `resolveUserRole` helper present + tested |
| Quick Note (pre-PR #34) | `apps/web/src/components/dashboard/today/quick-actions.tsx` | ⏳ localStorage stub on main (correct starting point) |
| Autopilot cron (pre-PR #36) | `apps/web/src/app/api/cron/autopilot/route.ts` | ⏳ 3 TODOs on main (correct starting point) |
| Email templates (pre-PR #33) | `apps/web/src/server/email/templates/` | ⏳ 4 templates on main (correct starting point) |

### Remaining TODO/FIXME inventory (24 total in `apps/web/src`)

Notable still-open TODOs *not* addressed by overnight work:
- `gcal-oauth` waitlist wiring in `dashboard/booking/gcal-sync-badge.tsx`
- `cancellation-policy` enforcement in `routers/booking.ts`
- PKCS#7 sealing in `contracts/flatten.ts` (B.5.1)
- Settings sub-tab follow-up TODO

These are pre-existing and outside the audit's 17 tracked tasks.

---

## Recommended merge sequence

Per the priority order in the original recap:

```
1. Merge PR #32 (Sentry + PostHog)        → unblocks diagnosing the 3 quarantined bugs
2. Merge PR #34 (Quick Note DB)           → smallest user-visible win, easiest to QA on preview
3. Merge PR #36 (Autopilot cron)          → ship the cron logic; scheduling waits for Pro tier
4. Merge PR #33 (8 email templates)       → bulk content; no behavior change yet
5. Merge PR #35 (Auto-changelog)          → tooling, lowest risk
```

**Conflict expected after PR #32 merges:** every subsequent PR needs `docs/audit-report.md` to be re-merged against the new tip. The conflict is always the same shape — both sides are appending to the status table + adding a fix-log section. Accept both. GitHub's web UI handles this in 30 seconds.

After all 5 merge:

```bash
# 1. Apply migrations to prod
/skitza-migrate

# 2. Add env vars to Vercel prod (see apps/web/.env.example § Sentry, § PostHog)

# 3. Smoke-test cron on preview before scheduling
curl -H "Authorization: Bearer $CRON_SECRET" https://<preview>.vercel.app/api/cron/autopilot
```

---

## What I want Gili to verify post-merge

After the 5 PRs merge + the deploy stabilizes:

- [ ] `/dashboard` loads (no Sentry init regression)
- [ ] Click Quick Note icon → type + save → refresh → note still there
- [ ] `/changelog` page renders with the new "Recent changes" section
- [ ] `gh workflow run changelog-update.yml` opens a PR successfully
- [ ] `curl` autopilot endpoint returns the expected JSON shape
- [ ] Sentry dashboard receives a test error (throw something in dev to verify wiring)
- [ ] PostHog dashboard receives a `$pageview` event from your next dashboard visit

---

## Sign-off

Audit complete. **No blocker found.** The 5 PRs are ready to merge in the recommended sequence. The only operational concern is the GitHub Actions billing block — fix it when convenient, but it doesn't block manual merge.

*Filed: 2026-04-23*
*Verifier: Claude (autonomous)*
