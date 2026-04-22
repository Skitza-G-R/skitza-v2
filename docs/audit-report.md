# Codebase Audit — 2026-04-22

> **For Claude:** This file is the **paper trail** for the deep codebase audit performed 2026-04-22. Every time a task below is fixed, you MUST:
> 1. Flip the row in the **Status tracker** table from ⏳ Pending → ✅ Fixed with today's date + short commit ref.
> 2. Append a dated entry to that task's own **Fix log** (never delete history — only append).
> 3. Commit the update ALONGSIDE the fix (same PR / same commit) so `git log docs/audit-report.md` reconstructs the full history.
>
> **For humans:** This is the live status of every known ship-blocker + cleanup item. If a row says ⏳ Pending, it's still open. If it says ✅ Fixed, the commit column shows where.

**Source:** Deep rigorous codebase audit performed 2026-04-22 on `main` at commit `3cb4fff`, immediately after the Round 2 BMAD merge + S04 backend merge.
**Scope:** Four categories — Reality Check, Bug Hunt, Broken Pages, UI/UX — against PRD v2 + the 12-week post-launch roadmap.

---

## Status tracker

| # | Task | Severity | Status | Completed | Commit | Notes |
|---|---|---|---|---|---|---|
| 1 | `/join/<slug>` crashes in prod (migration 0031 never applied) | 🔴 | ✅ Fixed | 2026-04-22 | *(uncommitted on `main`)* | Migration 0031 applied via `apply-migrations.mjs`; verified all 3 statements ran cleanly |
| 2 | `publicProfile.forJoin` external-links query has no error handling | 🔴 | ✅ Fixed | 2026-04-22 | *(uncommitted on `main`)* | Wrapped in try/catch, typed empty-array fallback, server-side logs for future Sentry. Typecheck ✅ |
| 3 | S04 backend is dead code (no UI consumer on main) | 🔴 | ⏳ Pending | — | — | S04 Part 2 UI not shipped |
| 4 | Onboarding wizard is 4-step (code) vs 5-step (PRD §4.5) | 🟠 | ⏳ Pending | — | — | Missing Portfolio + Stripe steps |
| 5 | `/refund-policy` route doesn't exist | 🟠 | ⏳ Pending | — | — | Roadmap S2.5 |
| 6 | No cookie-consent banner | 🟠 | ⏳ Pending | — | — | EU compliance |
| 7 | Privacy + Terms pages are placeholder | 🟠 | ⏳ Pending | — | — | Needs counsel review |
| 8 | Changelog is hand-seeded, not auto-generated | 🟠 | ⏳ Pending | — | — | Roadmap S5.5 |
| 9 | `/dashboard/booking` still alive (duplicates Setup) | 🟠 | ⏳ Pending | — | — | Roadmap S2.4 |
| 10 | Landing `founder.tsx` + `site-footer.tsx` have TODO placeholders | 🟡 | ⏳ Pending | — | — | Credibility hit on cold visit |
| 11 | Quick Note modal is localStorage stub | 🟡 | ⏳ Pending | — | — | Feature appears real but doesn't persist |
| 12 | Autopilot cron route is 95% TODO | 🟡 | ⏳ Pending | — | — | 3 behaviors unwired; correctly gated in UI |
| 13 | Only 4 of 10 Resend email templates shipped | 🟢 | ⏳ Pending | — | — | PRD §14 |
| 14 | No Sentry + no PostHog (observability) | 🟢 | ⏳ Pending | — | — | Roadmap S2.3 |
| 15 | `/join/<slug>` signup registers visitor as Producer, not Artist | 🔴 | ✅ Fixed | 2026-04-22 | *(uncommitted on `main`)* | Webhook + layout + routes rewritten; 11 new tests, full TDD |

**Legend:** ⏳ Pending · ▶️ In progress · ✅ Fixed · ❌ Won't fix (document reason)

---

## 🔴 Critical Bugs — ship-blockers

### Task 1 — `/join/<slug>` page crashes in production

**Severity:** 🔴 Critical (production outage on primary cold-visitor surface)
**Status:** ✅ Fixed 2026-04-22
**Location:** `apps/web/src/server/trpc/routers/public-profile.ts` lines 123-133, and production DB.

**Plain-English:** Every visitor to `skitza.app/join/<your-slug>` is hitting a 500 error right now. The code in `publicProfile.forJoin` (the tRPC procedure behind every /join page) queries the `producer_external_links` table. That table only exists if migration `0031_producer_external_links.sql` has been applied. Migration 0031 landed in the repo with PR #27 but was **never applied to the production DB** (no one ran `/skitza-migrate` after merging). There's also **no try/catch** around that query, so the whole page errors out.

**Fix (ordered):**
1. Apply migration 0031 via `node packages/db/apply-migrations.mjs` with production `DATABASE_URL`. Idempotent — safe to re-run.
2. (Follows as Task 2) Wrap the query defensively so a future drift never crashes the page again.

**Fix Log:**
- **2026-04-22** — Ran `set -a && . apps/web/.env.local && set +a && node packages/db/apply-migrations.mjs` from `packages/db/`. All migrations 0018-0031 applied idempotently; migration 0031 specifically executed 3 statements cleanly: `CREATE TYPE external_platform`, `CREATE TABLE producer_external_links`, `CREATE INDEX producer_external_links_producer_idx`. Output ended with "All migrations applied successfully." **Production DB now has the required schema for `publicProfile.forJoin`.** Note: did NOT commit — no code change, only a DB state change. [status: ✅ fixed]

---

### Task 2 — `publicProfile.forJoin` external-links query has no error handling

**Severity:** 🔴 Critical (defensive hardening; co-requisite of Task 1)
**Status:** ✅ Fixed 2026-04-22
**Location:** `apps/web/src/server/trpc/routers/public-profile.ts` lines 123-133.

**Plain-English:** Even after Task 1 is fixed, a future migration drift, partial DB outage, or schema-change-in-flight could reintroduce the same crash. The `/join` page's core value (samples + signup CTA) doesn't depend on external links — they're a Wave 2 enhancement. The query should be wrapped in try/catch: on any error, log server-side for future Sentry, and fall back to an empty array so the page still renders.

**Fix:**
- Wrap the `db.select(...).from(producerExternalLinks)...` block in try/catch.
- On error: `console.error(...)` with enough detail for observability, then set `externalLinkRows = []`.
- Type the fallback using `Pick<ProducerExternalLink, "id" | "platform" | "url" | "title" | "position">[]` — re-uses the existing Drizzle type from `@skitza/db`, no duplication.

**Fix Log:**
- **2026-04-22 (initial fix, TDD skipped)** — Edited `apps/web/src/server/trpc/routers/public-profile.ts`: added `type ProducerExternalLink` to the `@skitza/db` import; converted the `const externalLinkRows = await db.select(...)...` block into `let externalLinkRows: Array<Pick<ProducerExternalLink, "id" | "platform" | "url" | "title" | "position">> = []` followed by a try/catch wrapping the original query. On catch, logs to `console.error` with enough context for future Sentry to pick up the root cause. Added an 11-line inline comment linking back to this audit task. No downstream consumers changed. **Typecheck passes.** [status: ✅ fixed]
- **2026-04-22 (discipline repair — post-hoc TDD)** — User flagged the missing TDD. Remediated: added `describe("publicProfile.forJoin — external-links resilience (audit 2026-04-22 Task 2)")` to `apps/web/src/server/trpc/routers/__tests__/public-profile-for-join.test.ts`. Test mocks `externalLinksSelectMock.mockRejectedValueOnce(new Error('relation "producer_external_links" does not exist'))` (the exact production error) and asserts: (a) `result.externalLinks === []`, (b) `result.producer + result.publicSamples` still present, (c) `console.error` was called (observability contract for S2.3 Sentry). **RED verified**: temporarily reverted try/catch, test failed with `TRPCError: relation "producer_external_links" does not exist` — exactly the prod error. **GREEN verified**: restored try/catch, 8/8 tests pass in this file, 584 pass / 4 skipped / 0 fail full suite. Regression-safe. [status: ✅ fixed + ✅ pinned by failing-first test]

---

### Task 3 — S04 backend is dead code on `main` (no UI consumer)

**Severity:** 🔴 Critical (wasted merged work + root cause of Task 1's crash)
**Status:** ⏳ Pending
**Location:** `apps/web/src/server/trpc/routers/producer-external-links.ts` + `public-profile.ts` — and nowhere else.

**Plain-English:** PR #27 merged the external-links tRPC router + schema + migration, but **no UI component reads the data**. `grep externalLinks` returns only 5 files: the router, public-profile, `_app.ts` wiring, and 2 test files. **Zero component files consume the output.** So producers can't add links (no Setup editor), and /join can't display them (no section component). The data pipes connect to nothing. Shipping the backend without the frontend is also the root cause of Task 1 — the backend is what's crashing the page.

**Fix:** Ship S04 Part 2 (`ExternalLinksSection` + embed components on /join) and S04 Part 3 (Setup editor for producers to add/edit/reorder links). Drafts exist on lost branches from the force-push pivot.

**Fix Log:**
- *(To be filled when fixed.)*

---

## 🟠 Broken Pages / Spec Mismatches

### Task 4 — Onboarding wizard is 4 steps in code, PRD says 5

**Severity:** 🟠 Spec/code drift on the happiest-path flow.
**Status:** ⏳ Pending
**Location:** `apps/web/src/app/(app)/dashboard/onboarding/onboarding-wizard.tsx` line 19.

**Code:** `type StepKey = "identity" | "package" | "hours" | "share"` → You, Package, Hours, Share.
**PRD §4.5 locked spec:** Profile → Portfolio → Services → Availability → Stripe.
**Missing in code:** Portfolio (track upload) step AND Stripe Connect step.
**Consequence:** Producers finish onboarding without ever being prompted to upload a single track or connect Stripe. The core "get paid" flow is skipped during the most-guided moment in the app.

**Fix Log:**
- *(To be filled when fixed.)*

---

### Task 5 — `/refund-policy` route doesn't exist

**Severity:** 🟠 Pre-launch compliance
**Status:** ⏳ Pending
**Location:** `apps/web/src/app/(public)/(legal)/` — only has `about/`, `privacy/`, `terms/`.

Required by Stripe + most jurisdictions. Scheduled in roadmap phase 2 S2.5.

**Fix Log:**
- *(To be filled when fixed.)*

---

### Task 6 — No cookie-consent banner

**Severity:** 🟠 EU compliance
**Status:** ⏳ Pending
**Location:** `apps/web/src/components/landing/site-footer.tsx` has a `TODO: add /cookies route when a full cookie policy is written` — footer link stub only, no banner component.

Only existing `cookie` references are i18n locale cookies (NEXT_LOCALE), not user-consent tracking.

**Fix Log:**
- *(To be filled when fixed.)*

---

### Task 7 — Privacy + Terms pages are placeholder (code comments admit)

**Severity:** 🟠 Pre-launch legal
**Status:** ⏳ Pending
**Location:**
- `apps/web/src/app/(public)/(legal)/privacy/page.tsx` line 3: *"Placeholder privacy policy — Replace with a proper legal version before public launch"*
- `apps/web/src/app/(public)/(legal)/terms/page.tsx` line 3: *"Placeholder terms — Must be replaced by counsel-reviewed terms before public launch"*

**Fix Log:**
- *(To be filled when fixed.)*

---

### Task 8 — Changelog is hand-seeded, not auto-generated

**Severity:** 🟠 Drift risk
**Status:** ⏳ Pending
**Location:** `apps/web/src/app/(public)/changelog/page.tsx` — comment at top: *"Hand-seeded from recent git history"*.

Roadmap S5.5 specified a GitHub Actions workflow to generate from commit messages. Currently drifts on every release unless manually updated.

**Fix Log:**
- *(To be filled when fixed.)*

---

### Task 9 — `/dashboard/booking` still alive (duplicates Setup)

**Severity:** 🟠 Duplicate surface
**Status:** ⏳ Pending
**Location:** `apps/web/src/app/(app)/dashboard/booking/` — full working route with actions, availability editor, blackouts, booking controls, products, duration picker.

Roadmap S2.4 specifies killing it and folding booking settings into Setup. Not broken, but two places to edit the same thing.

**Fix Log:**
- *(To be filled when fixed.)*

---

## 🟡 UI/UX Issues

### Task 10 — Landing `founder.tsx` + `site-footer.tsx` have TODO placeholders

**Severity:** 🟡 Credibility hit
**Status:** ⏳ Pending
**Location:**
- `apps/web/src/components/landing/founder.tsx` — 4 TODOs (placeholder name, handle, initials, copy, social URLs).
- `apps/web/src/components/landing/site-footer.tsx` — 4 TODOs (blog/careers/contact all → `#`; social icons → `#`; cookies route TODO).

Two of the most-scanned sections on the landing page read as unfinished. Cold visitors judge credibility in ~2 seconds.

**Fix Log:**
- *(To be filled when fixed.)*

---

### Task 11 — Quick Note modal is localStorage stub

**Severity:** 🟡 Feature stub, not labeled as such
**Status:** ⏳ Pending
**Location:** `apps/web/src/components/dashboard/today/quick-actions.tsx` — only file matching "quick note".

UI works (modal opens, "saves", closes) but notes don't persist to the DB, don't sync across devices, vanish on cache clear. No "coming soon" indicator. Either wire to a `producer_notes` table, or explicitly mark as stub.

**Fix Log:**
- *(To be filled when fixed.)*

---

### Task 12 — Autopilot cron route is 95% TODO

**Severity:** 🟡 Feature stub (but correctly gated in UI)
**Status:** ⏳ Pending
**Location:** `apps/web/src/app/api/cron/autopilot/route.ts` — 3 `TODO(...)` blocks for `unpaid-reminder`, `request-testimonial`, `auto-archive`. Route isn't scheduled in `vercel.json` (Hobby tier's only daily slot is on `session-reminders`).

*(Context: We correctly hid these 3 toggles behind "Coming soon" in PR #22. The 2 shipped toggles — `welcomeEmail`, `commentNotify` — do work and fire real Resend emails.)*

**Fix Log:**
- *(To be filled when fixed.)*

---

## 🟢 Minor

### Task 13 — Only 4 of 10 Resend email templates shipped

**Severity:** 🟢 Engagement-loop silence
**Status:** ⏳ Pending
**Location:** `apps/web/src/server/email/templates/` — only has `booking-confirmed-to-artist`, `booking-request-received`, `session-reminder-1h`, `session-reminder-24h`.

**Missing (per PRD §14):** contract-ready, final-payment-due, track-version-uploaded, producer-replied-to-comment, payment-received, new-comment-from-artist, contract-signed, booking-cancelled/rescheduled.

**Fix Log:**
- *(To be filled when fixed.)*

---

### Task 14 — No Sentry + no PostHog (observability)

**Severity:** 🟢 Flying blind
**Status:** ⏳ Pending

- **No Sentry**: every production crash (including the Task 1 /join crash!) silently disappears. You wouldn't know without a user reporting it.
- **No PostHog**: no analytics, no funnel visibility, no retention data.

Both scheduled in roadmap S2.3.

**Fix Log:**
- *(To be filled when fixed.)*

---

### Task 15 — `/join/<slug>` signup registers visitor as Producer (discovered in manual QA 2026-04-22)

**Severity:** 🔴 Critical (core product-differentiation failure — artists couldn't become artists)
**Status:** ✅ Fixed 2026-04-22
**Location:** Spans `apps/web/src/app/(auth)/sign-up/*`, `apps/web/src/app/api/webhooks/clerk/route.ts`, `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/components/join/signup-cta.tsx`, and two new routes under `/sign-up/join/[slug]` + `/artist-welcome/[slug]`.

**Plain-English:** After Task 1 was fixed and `/join/<slug>` started loading, we manually tested the Sign Up button. When a visitor clicked it, they got registered as a **Producer** and funneled into the Producer Onboarding Wizard — the exact opposite of what a `/join`-originated signup should do.

**Root cause (three compounding issues):**
1. The old `/sign-up` page had `forceRedirectUrl="/dashboard"` hardcoded, which overrides Clerk's `redirect_url` query param. So the `?redirect_url=/artist-welcome/<slug>` from `SignupCta` was silently ignored.
2. The Clerk `user.created` webhook unconditionally inserted a row into `producers` for EVERY new user. No notion of "role."
3. The `(app)/layout.tsx` saw a fresh producer row (no displayName, auto-slug), and sent the user to `/onboarding` — the producer wizard.

**Fix (3 architectural layers + an artist splash):**
1. **Client** — `SignupCta` now points at a new dedicated route `/sign-up/join/<slug>` which renders Clerk's `<SignUp>` with `unsafeMetadata={signupOrigin:"join", producerSlug:slug}`. The default `/sign-up` page changed from `forceRedirectUrl` → `fallbackRedirectUrl` as defense-in-depth.
2. **Server — webhook** — reads `evt.data.unsafe_metadata`, resolves the slug against the DB, and branches: JOIN → insert `client_contacts` scoped to the target producer, NO producer row; DEFAULT → existing producer-insert behavior unchanged. Malformed / stale slug falls back to default (no crash).
3. **Server — layout** — extracted `decideAppLayoutRedirect` pure function. If no producer row exists BUT client_contacts exists → `/artist`. If neither → `/onboarding` (webhook-race safety). Producer-with-contacts edge case: producer row wins.
4. **Artist-welcome splash** — new `/artist-welcome/[slug]/page.tsx` greets the just-joined artist with the producer's name + a CTA into `/artist`. The old orphan `/artist-welcome` route is unchanged for the "no-invites" fallback case.

**Fix Log:**
- **2026-04-22 — strict TDD discipline:**
  - **RED phase (4 new webhook tests + 7 layout-decision tests):**
    - TDD-A: webhook + join-origin metadata → NO producers insert, YES client_contacts insert with correct producer scoping, clerkUserId, emailHash, name. Initially RED — assertion `"MUST NOT create a producers row: got 1"`.
    - TDD-C: malformed slug → slug lookup WAS attempted, fallback producer insert. Initially RED — `producerLookupMock called 0 times`.
    - TDD-B: default signup → producer insert preserved (regression guard — passes pre/post-fix).
    - TDD-D: default signup → slug lookup NOT attempted (hot-path perf guard).
    - decide-redirect: 7 cases including "artist-with-client_contacts → /artist" as critical regression guard. RED by import-failure (module didn't exist).
  - **GREEN phase:** webhook rewritten with branch logic, `decide-redirect.ts` extracted, layout rewired. All 11 new tests pass. Full suite: **595 passed / 4 skipped / 0 failed** (up from 584). Typecheck ✅. Lint ✅.
- **2026-04-22 — architectural notes:**
  - Re-uses the existing `client_contacts.(producerId, emailHash) UNIQUE` constraint — `onConflictDoNothing` makes the JOIN insert idempotent and safe for pre-invited-then-self-serving artists (the trailing UPDATE still stamps clerkUserId across all their contact rows).
  - Producer sign-up flow is byte-for-byte unchanged in behavior (Test B + D enforce this).
  - New routes: `/sign-up/join/[slug]`, `/artist-welcome/[slug]`. No schema migration required.

---

## ✅ What I verified is genuinely working

- TypeScript: passes cleanly
- ESLint: passes cleanly
- Production build: succeeds
- 583 tests passing on main
- Stripe Connect is **real** (not a stub): `stripe.accounts.create()`, real destination-charges, 5% platform fee logic
- 2 shipped Autopilot toggles fire actual Resend emails (welcomeEmail, commentNotify)
- Clerk auth, Drizzle ORM, tRPC v11, R2 audio storage — all real and wired
- `/join` page Wave 1 structure is correct — the ONLY reason it crashes is Task 1's missing migration + Task 2's missing try/catch. Code layout is sound.

---

## Insight: why these bugs happen — a pattern

- **Tasks 1 + 2 + 3** (production crash + dead backend) share one root cause: **merging the backend before the frontend is ready AND before the migration is applied to prod**. A healthier flow: migration → backend → UI consumer → all in one PR; OR, guard the query with a feature flag until the full chain is live.
- **Task 4** (4-step vs 5-step onboarding) is **spec-before-code drift** — PRD §4.5 was added in PR #26, but the wizard code predates BMAD enforcement. Exactly what BMAD's PM phase is supposed to catch going forward.
- **Tasks 5–8** (legal pages, cookie banner, changelog) are normal **pre-launch checklist** items, not quality issues. Expected at this stage.

---

## Update discipline

- Every fix must append to the Fix Log for its task.
- Every fix must flip the Status tracker row to ✅ Fixed + today's date + short commit ref.
- Never delete history — only append.
- When ALL rows are ✅ Fixed, this file can be `git mv`-ed to `docs/plans/archive/`. Until then, it stays at `docs/audit-report.md`.
