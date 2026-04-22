# Overnight Execution Plan — 2026-04-22

> **For Claude:** This is a self-contained brief for autonomous overnight work. Read top to bottom before starting. Every task below is scoped so you can execute it without asking Gili anything. If you hit a question that's not answered here, **stop** and leave a note — don't guess.

> **For Gili:** This captures everything we attempted today, what shipped, what got abandoned, what's still open from the audit, and what's safe for Claude to run autonomously while you sleep. Review the Ground rules + Task backlog. When you're ready, say "go" and Claude will start at Task 1.

---

## 1. Today's reckoning

### ✅ Shipped on main (via PR #30, commit `3662a2b`)

| Audit task | What landed |
|---|---|
| Task 1 | Migration 0031 applied to production DB |
| Task 2 | `publicProfile.forJoin` try/catch resilience + RED-verified test |
| Task 15 | `/join` signup routes visitor to Artist identity (webhook branches on `unsafeMetadata`, new `/sign-up/join/<slug>` catch-all route, `/artist-welcome/<slug>` splash) |
| Task 16 | Strict role isolation: `resolveUserRole` helper + `/onboarding` gate + action hardening + 16 new tests |
| Task 17 Phase 1 | UserButton in artist shell + "Producer dashboard" menu item for dual-role users |

### ❌ Abandoned (branch `feat/task-17-artist-desktop-sidebar`, PR #31 closed unmerged)

Multiple ping-pong fix attempts on the artist signup/welcome flow that didn't land:
- Task 17 Phase 2 — desktop sidebar rebuild (built but bundled with other abandoned work)
- Task 17 Phase 3 — `/artist/settings` page (built but same)
- `/sign-in` `forceRedirectUrl` removal (right fix, bundled)
- `/artist-welcome` no-slug role guard (right idea, implementation caused issues)
- Webhook-race server action + auto-redirect (silent failure we couldn't diagnose)
- `(artist)/layout` self-heal (created infinite redirect loop)

**What went wrong:** we tried to fix production Clerk/webhook bugs without observability (no Sentry, no PostHog). Multiple attempts looked green in tests but failed in prod with no diagnosable signal. The fix churn introduced a redirect loop.

**Lesson:** Don't touch the Clerk signup/webhook flow again until Sentry is wired (Task 14 below). With real error logs we can diagnose these in minutes instead of hours.

### 🟠 Known bugs still on main (parked for now)

| Bug | Why parked |
|---|---|
| `/sign-in` has `forceRedirectUrl="/dashboard"` — ignores `redirect_url` query param | Fix is trivial but needs to be verified on preview with Sentry to catch any downstream impact |
| `/artist-welcome` (no slug) renders orphan copy for users who actually have studios | Fix is trivial but same reason |
| Webhook race on `/artist-welcome/<slug>` — fast-clickers land on orphan | Needs deeper diagnosis with Sentry + Vercel logs before re-attempting |

These are real bugs but they don't break the producer side of the product. Real artist clients wait a second on the welcome splash (hiding the race) and don't sign in manually via `/sign-in` (avoiding issue #1). We fix these properly once we have observability.

---

## 2. Ground rules for autonomous execution

These are non-negotiable. If any of them are about to be violated, **stop and leave a note** instead of proceeding.

1. **One branch + one PR per task.** Branch names: `feat/task-<N>-<slug>`. Never commit directly to main. Never force-push.

2. **TDD where behavior is code.** Failing test first, RED verified via running the test and seeing the failure message, then GREEN via implementation. Pure-config tasks (Task 14 Sentry install) can skip TDD — the "test" is it boots.

3. **Full verify before every commit:** `pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test` must all pass.

4. **Per-commit discipline:** small commits, conventional-commit prefixes (`feat:`, `fix:`, `docs:`), meaningful bodies. Each commit independently revertable.

5. **Paper trail in every PR:** update `docs/audit-report.md` Fix Log for the task in the same commit as the code. Never let the tracker drift.

6. **Quarantine list — DO NOT TOUCH THESE FILES OVERNIGHT.** They're implicated in the artist-welcome ping-pong and need Sentry data + Gili's eyes before any further edits:
   - `apps/web/src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`
   - `apps/web/src/app/(auth)/sign-up/[[...sign-up]]/page.tsx`
   - `apps/web/src/app/(auth)/sign-up/join/[slug]/[[...rest]]/page.tsx`
   - `apps/web/src/app/(artist)/artist/layout.tsx`
   - `apps/web/src/app/(artist-welcome)/**/*`
   - `apps/web/src/app/api/webhooks/clerk/**/*`
   - `apps/web/src/components/artist/artist-app-shell.tsx`
   - `apps/web/src/components/artist/artist-sidebar.tsx` (if it exists from the abandoned branch — it shouldn't after the revert)

7. **Stop on blockers.** If a task needs a design decision, a piece of copy Gili hasn't provided, a business rule not in `docs/product/PRD.md`, or access to an external service (Sentry key, PostHog key, Clerk secret on preview) — STOP. Don't guess. Document what you need in the PR description and move to the next task.

8. **Don't open more than 5 PRs overnight.** Gili has to review each one. If you finish 5, stop and wait for morning.

9. **Migration safety:** any new DB migration follows the project rules — idempotent `ADD COLUMN IF NOT EXISTS` style, `BEGIN; ... COMMIT;` wrapped, applied via `node packages/db/apply-migrations.mjs`. **Never touch `_journal.json`.**

10. **Commit messages end with** `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## 3. Task backlog (priority order)

Execute in order. If Task N blocks, skip to Task N+1 rather than stalling.

**Quick index:**
- **A** — Sentry + PostHog (audit #14) — ~1-2h — 🏆 do first, unblocks everything else
- **B** — Missing email templates (audit #13) — ~3-4h — pure additive
- **C** — Quick Note DB backing (audit #11) — ~1-2h — stub removal
- **D** — Auto changelog via GH Actions (audit #8) — ~1-2h — CI/CD
- **E** — Autopilot cron behaviors (audit #12) — ~2-3h — needs migration 0033
- **F** — S04 external-links UI (audit #3, parts 2+3) — ~4-6h — pure frontend on merged backend

Total: ~12-19h of work. Cap at **5 opened PRs** for Gili's review bandwidth (i.e. skip F or split into a second night if A-E take the full window).

### Task A — Install Sentry + PostHog (audit Task 14) 🏆 DO FIRST

**Why first:** today's artist-welcome ping-pong happened because we couldn't see what was actually running in production. Sentry would have told us in 30 seconds that a server action was throwing, or that a redirect loop was happening. Every other overnight task is lower-risk once this lands.

**Scope:**
- Install `@sentry/nextjs`, run its init wizard (or manual config: `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `next.config.js` wrapping).
- Install `posthog-js` for client-side analytics. Wire a `<PostHogProvider>` at the root layout.
- Add env vars to `.env.example`: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`.
- Boot locally, confirm events flow to both services (use test projects — Gili to wire real keys later if needed).
- Update `docs/audit-report.md` Task 14 → ✅ Fixed.

**Blocker risk:** if Sentry/PostHog API keys aren't configured on Vercel, the wiring still compiles but no events flow in production. That's OK — deliver the wiring, document the env vars Gili needs to set.

**Acceptance:**
- `pnpm -F web build` succeeds with Sentry webpack plugin configured (even if DSN is unset — wrap in optional check).
- A deliberate `throw new Error("sentry-smoke-test")` in a test route shows up in Sentry's test project.
- Posthog's `$pageview` event captures on client navigation.

**Estimate:** 1-2 hours.

**Branch:** `feat/task-14-observability`

---

### Task B — Ship the 6 missing Resend email templates (audit Task 13)

**Why now:** pure additive work, zero risk of breaking existing flows. Each template is a self-contained React Email component. High leverage on the engagement loop.

**Missing templates** (per PRD §14):
1. `contract-ready.tsx` — fires when producer publishes a contract for signature
2. `final-payment-due.tsx` — fires 3 days before a project's final payment
3. `track-version-uploaded.tsx` — fires when producer uploads a new mix on a project
4. `producer-replied-to-comment.tsx` — fires when producer replies to an artist comment
5. `payment-received.tsx` — fires when Stripe confirms a payment webhook
6. `new-comment-from-artist.tsx` — fires to producer when artist comments on a track
7. `contract-signed.tsx` — fires to producer when all signers complete
8. `booking-cancelled-or-rescheduled.tsx` — fires when session status changes

**Scope per template:**
- Create the `.tsx` file under `apps/web/src/server/email/templates/`
- Write a smoke test: render the component with sample props, assert it returns HTML.
- Wire the template to its trigger point in existing code (e.g. `payment-received` hooks into the Stripe webhook handler where `invoice.paid` is recorded — grep for existing DB writes and add the Resend call alongside).
- Don't invent new trigger points. If a template's natural trigger isn't already in the codebase, document it and skip that one template.

**Acceptance:**
- All shippable templates have a smoke test that renders without throwing.
- Each template is wired (or documented as "trigger-not-yet-built, skipped").
- `docs/audit-report.md` Task 13 updated with "X of 8 shipped, Y deferred, reasons listed."

**Estimate:** 3-4 hours.

**Branch:** `feat/task-13-email-templates`

**Reference:** look at existing `booking-confirmed-to-artist.tsx` and `session-reminder-24h.tsx` for the pattern. Use `@react-email/components` (already installed).

---

### Task C — Wire Quick Note modal to the DB (audit Task 11)

**Why:** the Today page's Quick Note modal currently persists to `localStorage`. Artists think they're taking notes but it's all in-browser. First user who clears cache loses everything.

**Scope:**
- **Migration:** add `producer_notes` table. `id uuid pk, producer_id uuid fk, body text not null, created_at, updated_at`. Indexed on `(producer_id, created_at desc)`. Migration file `packages/db/drizzle/0032_producer_notes.sql`.
- **Schema:** add `producerNotes` table to `packages/db/src/schema.ts` + `ProducerNote` / `NewProducerNote` types.
- **tRPC:** `producerProcedure`-gated `producer.saveNote({body}) → {id}` + `producer.listNotes() → {notes: ProducerNote[]}`.
- **UI:** update `apps/web/src/components/dashboard/today/quick-actions.tsx` to call `saveNote` mutation instead of writing to localStorage. Include optimistic update for zero-latency feel.
- **TDD:** tRPC router tests for save + list (mock-DB pattern already established, see `apps/web/src/server/trpc/routers/__tests__/artist-home.test.ts` for the idiom).

**Acceptance:**
- New migration applied via `apply-migrations.mjs` (test it locally against a scratch DB or just confirm the SQL is valid).
- Saving a note persists to DB; reload shows it.
- Existing localStorage notes are not migrated (acceptable — this is a new feature, old notes weren't real).
- Typecheck + lint + tests pass.

**Estimate:** 1-2 hours.

**Branch:** `feat/task-11-quick-note-db`

---

### Task D — Auto-generated changelog via GitHub Actions (audit Task 8)

**Why:** the `/changelog` page is currently hand-seeded from recent commits. Will drift. Automating it means new features ship to the changelog automatically.

**Scope:**
- **Workflow:** `.github/workflows/changelog.yml`. On push to `main`, parse commits with conventional-commit prefixes, group by type (`feat:`, `fix:`), and output markdown.
- **Data file:** write the generated markdown to `apps/web/src/app/(public)/changelog/data.generated.json` or `.md`.
- **Page update:** modify `apps/web/src/app/(public)/changelog/page.tsx` to read the generated data.
- Skip commits that are `chore:`, `docs:`, `test:`, `ci:` (non-user-facing).

**Acceptance:**
- Workflow runs successfully on a test branch first (manually triggered via `workflow_dispatch`).
- Page renders identically to the current hand-seeded version for the most recent release.
- No action on branches other than `main`.

**Estimate:** 1-2 hours.

**Branch:** `feat/task-8-auto-changelog`

**Alternative if blocked:** if the workflow gets complex, ship a simpler script that Gili can run manually (`pnpm changelog:regen`) and have the changelog page read from a committed JSON file. Document as "semi-automatic" in the PR.

---

### Task F — Ship S04 external-links UI (audit Task 3, parts 2 + 3)

**Why:** the `producer_external_links` table + tRPC router + migration 0031 are all merged on main (PR #27 + PR #30), but **no UI consumes it**. Producers can't add links; `/join/<slug>` can't show them. Pure dead code until this ships. Unblocks a core PRD §6.2 Section B feature (hybrid /join page with Skitza samples + external embeds).

**Two sub-tasks:**

**F-Part-2 — `ExternalLinksSection` on `/join/<slug>` (public page):**
- New component at `apps/web/src/components/join/external-links-section.tsx`
- Renders the `data.externalLinks` array returned by `publicProfile.forJoin` (already wired server-side since PR #27/30).
- 7 supported platforms per PRD §6.2: Spotify, Apple Music, YouTube/YouTube Music, SoundCloud, Bandcamp, Tidal, Instagram Reels.
- Each link renders as a platform-native iframe / oEmbed (Spotify embed iframe, YouTube embed, etc.). Where oEmbed is too heavy, use a clean hover card linking out.
- No auth gating — these tracks are already public on origin platforms.
- Mount in `apps/web/src/app/(public)/join/[slug]/page.tsx` below `PublicSamplesPlayer`.
- **TDD:** unit tests for the URL→embed URL parser per platform (edge cases: short URLs, tracking params, playlist vs single-track, etc.).

**F-Part-3 — Setup CRUD UI for external links (producer side):**
- New sub-tab in `/dashboard/settings` (or nested inside the existing "portfolio" section — grep for the existing pattern).
- tRPC procedures already exist (`producerExternalLinks.*`). Verify + wire:
  - `.list()` — fetch all links for this producer, ordered by `position`
  - `.create({platform, url, title})`
  - `.update({id, platform, url, title})`
  - `.delete({id})`
  - `.reorder({ids})` — position update bulk
- UI: table view with platform icon, URL, title (optional), position. Add button at top, edit/delete per row, drag-to-reorder (or simpler up/down arrows if DnD is too much).
- **TDD:** tRPC router tests for each procedure using the mock-DB pattern (scoped to `ctx.producerId`).

**Acceptance:**
- A producer can add 3 Spotify + 1 YouTube link via Setup, see them on `/join/<their-slug>`, each playable without leaving the page.
- Re-ordering persists.
- Deleting removes from both surfaces.
- All tests pass.

**Estimate:** 4-6 hours (the bulk is the 7 platform embed parsers + the Setup CRUD form).

**Branch:** `feat/task-3-external-links-ui`

**Blocker risk:** if any specific platform's embed needs an API key (unlikely for iframe embeds, likely for oEmbed), defer that one platform and document.

---

### Task E — Autopilot cron: wire the 3 TODO behaviors (audit Task 12)

**Why:** `api/cron/autopilot/route.ts` has 3 `TODO` blocks. Currently returns `{ok:true, deferred:[...]}` — passes smoke tests but does nothing. Gili's Autopilot feature is sold to producers as "set it and forget it" — they need to actually fire.

**Prereq migration (0033):** add columns:
- `invoices.reminder_sent_at timestamptz` (idempotent reminder tracking)
- `projects.testimonial_requested_at timestamptz`
- Migration file `packages/db/drizzle/0033_autopilot_idempotency.sql`

**Scope:**
- **`unpaid-reminder`:** `SELECT * FROM invoices WHERE status IN ('draft','sent') AND created_at < now() - 7d AND reminder_sent_at IS NULL AND producer.autopilot_unpaid_reminder = true` → for each, send a Resend reminder email to the producer + stamp `reminder_sent_at = now()`.
- **`request-testimonial`:** `SELECT * FROM projects WHERE stage='paid' AND testimonial_requested_at IS NULL AND producer.autopilot_request_testimonial = true` → email the artist + stamp `testimonial_requested_at`.
- **`auto-archive`:** `UPDATE projects SET stage='archived' WHERE stage='paid' AND updated_at < now() - 30d AND producer.autopilot_auto_archive = true`.
- **TDD:** for each behavior, test the SQL predicate (use the mock-DB pattern). Test idempotency: running the cron twice doesn't email twice.
- **vercel.json:** add `{ path: "/api/cron/autopilot", schedule: "0 */6 * * *" }` **BUT** Hobby tier only allows 1 daily cron. Current `session-reminders` already consumes it. Either (a) document that we need to upgrade to Pro first, or (b) merge the two behaviors into `session-reminders`' daily sweep as a compromise.

**Blocker check:** if Gili's Vercel is still Hobby (check `vercel.json`'s existing crons), option (a) — document the prereq, ship the logic + tests, leave the schedule line for Gili to add when he upgrades.

**Acceptance:**
- Migration 0033 is idempotent and applies cleanly.
- All 3 behaviors have unit tests covering the happy path + idempotency.
- Running the route with `CRON_SECRET` returns the correct behavior counts in the response.
- Gili can smoke-test by manually curling the route.

**Estimate:** 2-3 hours.

**Branch:** `feat/task-12-autopilot-cron`

---

## 4. Tasks NOT for overnight (require Gili's input or review)

These stay in the backlog — do NOT attempt overnight.

| Audit # | Task | Why blocked |
|---|---|---|
| 4 | Onboarding 5-step rewrite (Portfolio + Stripe Connect steps) | Big UX change — PRD §4.5 has the spec but wireframe review preferred before 1-2h of work lands. |
| 5 | `/refund-policy` page | Needs Gili's business content (refund windows, non-refundable deposit policy, etc.). |
| 6 | Cookie banner | Needs policy content + visual design review. |
| 7 | Privacy + Terms real legal copy | Blocked on counsel. |
| 9 | Kill `/dashboard/booking`, fold into Setup | Big refactor, needs Gili to review UX trade-offs. |
| 10 | Landing page `founder.tsx` + footer real copy | Needs Gili's real copy (photo, handle, bio, social URLs). Cleaning up the TODO markers with generic placeholder would be reversible — do NOT overnight; let Gili write real copy. |
| 17 Phase 2+3 | Artist desktop sidebar + `/artist/settings` | Abandoned today, needs Sentry + rethink. Branch preserved. |
| — | Artist-welcome bugs: `/sign-in` `forceRedirectUrl`, no-slug role guard, webhook race | Need Sentry first (Task A) to diagnose safely. Re-attempt after Task A lands + Gili has real logs to review. |

### Mapping from earlier audit "fix-order" list

For reference — this is how the 9-item priority list from the original audit report maps into today's state:

| Fix # | Task | Where it ended up |
|---|---|---|
| 1 | Run `/skitza-migrate` | ✅ Shipped on main (Task 1, PR #30) |
| 2 | try/catch around externalLinks | ✅ Shipped on main (Task 2, PR #30) |
| 3 | Ship S04 Part 2 UI (`ExternalLinksSection`) | **Overnight Task F** |
| 4 | Replace founder.tsx + site-footer.tsx placeholders | **Parked above** — needs real copy |
| 5 | Reconcile onboarding 4 vs 5 steps | **Parked above** — needs wireframe review |
| 6 | Ship S04 Part 3 (Setup UI for links) | **Overnight Task F** (paired with Part 2) |
| 7 | S2.5 legal/refund/cookies | **Parked above** — blocked on counsel + business content |
| 8 | Sentry + PostHog | **Overnight Task A** |
| 9 | Missing email templates (6) | **Overnight Task B** |

---

## 5. End-of-overnight summary

When you're done (or out of safe tasks, whichever comes first):

1. **Update `docs/session_recap.md`** with the final state — branches opened, PRs opened, tasks completed, any blockers hit.
2. **Leave a single top-of-report note for Gili** summarizing in 3-5 bullets what to review first.
3. **Don't try to merge your own PRs.** Gili reviews + merges in the morning.

**Stop conditions:**
- Out of overnight-safe tasks (you've done A-F): stop, summarize, sleep.
- 5 PRs opened: stop (review bandwidth limit). If the first 5 complete and you still have time, a 6th is OK but must be marked as "draft" for Gili to only look at after the first 5.
- Any full-suite test failure you can't fix in 15 minutes: stop, leave the PR in draft, note the blocker.
- Any blocker on a task that's not in the "skip-forward" list: stop, move to next task.

---

## 6. Reference — current test + branch state

- **Main:** `3662a2b` — clean, 623 tests pass, typecheck ✅, lint ✅
- **Working tree:** clean (this plan file is the only uncommitted addition)
- **Open PRs:** none (PR #31 closed earlier tonight)
- **Session recap:** [`docs/session_recap.md`](../../session_recap.md)
- **Audit report:** [`docs/audit-report.md`](../../audit-report.md)
- **PRD:** [`docs/product/PRD.md`](../../product/PRD.md)
- **CLAUDE conventions:** [`CLAUDE.md`](../../../CLAUDE.md)

---

## 7. How Gili kicks this off

Once you approve this plan:

```
"go — start overnight execution"
```

Claude will:
1. Confirm the plan + repeat the quarantine list
2. Start Task A (Sentry + PostHog)
3. Commit + PR
4. Move to Task B
5. Continue until stop condition hit

Or if you want to handpick:

```
"start with Task B, skip A"
```

Or scope it tighter:

```
"only do A and B tonight"
```
