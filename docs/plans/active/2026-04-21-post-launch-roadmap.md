# Post-Launch Roadmap — Skitza v1 to Breakeven

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan phase-by-phase. Each phase is a BMAD Large track.

**Goal:** Take Skitza from "docs/cleanup PR open, /join Wave 1 unshipped, no Producer #0 content" (state as of 2026-04-21) to **100 paying producers and first revenue by July 10, 2026** — a ~12-week runway sprint.

**Architecture:** Six sequenced phases. Each phase is a coherent BMAD Large track with its own Analyst → PM → Architect → SM → Dev → Ship arc. Phases are dependency-chained but slippage-tolerant — if any phase runs >3 days long, the plan is re-written.

**Forcing function:** D1 runway. Revenue needed by July 2026 (per Round 2 Analyst pass, `docs/decisions/360-prd-answers.md`).

**Tech Stack:** Unchanged from PRD §27. No new stack decisions in this plan.

**PRD basis:** Product spec is locked in PRD v2 (`docs/product/PRD.md`). GTM playbook is PRD §28. Round 2 reasoning is in `docs/decisions/360-prd-answers.md`. This plan executes against those.

---

## Prerequisites

Before starting Phase 1, verify the foundation:

1. **Read `docs/session_recap.md`** for current branch + stash state.
2. **Baseline green**: `cd apps/web && pnpm test && pnpm typecheck && pnpm lint` — all green on `main`.
3. **Open PRs** that must merge before Phase 1:
   - **PR #18** `docs/cleanup` → main (docs architecture + session handoff)
   - **PR #17** `feat/bmad-skill` → main (BMAD enforcement)
   - **PR #16** `fix/db-consolidate-deals-to-projects` — close if already applied to prod; merge if not
   - **PR #19** (this plan's branch `docs/round-2-bmad`) → main (Round 2 decisions + this plan)

If PRs stale, Phase 1 opens with closing them.

---

## Ownership convention

| Role | What they do |
|---|---|
| **🤖 Claude** | All code, tests, plans, draft copy (emails/landing/ToS), commits, PRs, migrations, deploys |
| **👤 Gili** | Final copy decisions, legal reviews, pricing acceptance, physical visits (עוסק פטור), producer DMs, 1-on-1 beta calls, content creation (recording reels/videos), logo vendor approval, the 5 beta producer names |

Every story below names the owner. **Claude-owned stories** run via subagents (TDD where code is involved). **Gili-owned stories** are blockers Claude can only prep; no subagent for those.

---

## Phase 1 — Unblock (Apr 21–23, 0.5 weeks)

**Goal:** Clear everything sitting in PR limbo so Phase 2 starts on a clean `main`.

### Stories

**S1.1 — Merge PR #18 (docs/cleanup)** — 👤 Gili reviews, approves, merges.

**S1.2 — Merge PR #17 (feat/bmad-skill)** — 👤 Gili reviews, approves, merges. **Critical**: BMAD enforcement becomes active on main for all future branches.

**S1.3 — Close or merge PR #16** — 👤 Gili decides. Migration 0029 is already applied to prod (deals→projects). If PR has no new changes, close with "applied via direct SQL." Otherwise merge.

**S1.4 — Merge PR #19 (this plan + Round 2 decisions)** — 👤 Gili reviews, approves, merges.

**S1.5 — Rebase feat/join-flow on main; open PR** — 🤖 Claude. After #18, #17, #19 land, rebase the 5 Wave 1 commits on fresh main. Push. Open PR #20 "feat(join): Wave 1 — /join/\<slug\> teaser + public samples toggle + legacy /p removal." Test on preview URL. Merge.

**S1.6 — Pop the stash; split into 2 PRs** — 🤖 Claude.
  - Branch `docs/prd-onboarding-wizard` ← PRD §4.5 addition. Small PR #21.
  - Branch `docs/dashboard-plan-rewrite` ← the 2,616-line plan rewrite (archive the old version; active version if we decide to execute). PR #22.

### Phase 1 Definition of Done

- ✅ `main` has: docs cleanup + BMAD skill active + Round 2 decisions + /join Wave 1 shipped with preview URL verified
- ✅ Stash empty
- ✅ No PRs older than 3 days sitting open
- ✅ `docs/session_recap.md` checkpoint run

### Dependencies / risks

- **Risk**: PR #18 merge breaks something on main. **Mitigation**: preview URL smoke test before merge; docs-only PR has low code risk.
- **Risk**: rebasing feat/join-flow hits conflicts. **Mitigation**: feat/join-flow didn't touch any doc files, so rebase onto docs-cleanup-merged main should be clean.

---

## Phase 2 — Product polish (Apr 24 – May 7, 2 weeks)

**Goal:** Ship every feature the beta cohort needs to run real paid sessions. Feature-complete for soft launch.

### Stories

**S2.1 — /join Wave 2** — 🤖 Claude. Per `docs/plans/active/2026-04-20-join-flow-architecture.md` Wave 2 section.
  - S04: `producer_external_links` table + Setup UI + 7-platform embed components (Spotify / Apple Music / YouTube / SoundCloud / Bandcamp / Tidal / Instagram Reels)
  - S05: Post-signup welcome splash + `artist.attachStudio` tRPC + already-has-account confirm modal (PRD §6.4)
  - S06: Engagement approval flow (PRD §6.5) — `artist.startEngagement` → Today notification → approve/decline → payment step
  - S07: QuickActions "Preview public page" URL updated from `/p/` to `/join/`

**S2.2 — Resend wiring** — 🤖 Claude. Wire all 10 email triggers from PRD §14.
  - Artist side (5): Booking confirmed, Contract ready, Final payment due, Track version uploaded, Producer replied to comment
  - Producer side (5): New booking request, Payment received, New comment from artist, Contract signed, Booking cancelled/rescheduled
  - All use "Producer X via Skitza" branding (PRD F3). React Email templates. Test each end-to-end against a real inbox.

**S2.3 — Sentry install + first 10 PostHog events** — 🤖 Claude.
  - Sentry Next.js SDK + Vercel integration. Free tier. PR comments on regressions enabled.
  - PostHog SDK (cloud free tier for speed — self-host later). 10 key events:
    1. `share_link_copied` — producer hits Copy on `/dashboard`
    2. `public_profile_viewed` — stranger lands on `/join/<slug>`
    3. `public_sample_played` — stranger plays a sample track
    4. `artist_signup_started` — clicks Sign Up on `/join`
    5. `artist_signup_completed` — Clerk webhook fires user.created
    6. `producer_onboarding_step_completed` (per step 1-5)
    7. `producer_first_service_created`
    8. `producer_first_availability_set`
    9. `booking_requested` — artist books
    10. `booking_confirmed` — producer approves
  - Configure p0 paging per PRD §22.2b.

**S2.4 — Setup tabs fully inline** — 🤖 Claude. Complete the Task 10-12 slice from the dashboard refactor plan: fold `/dashboard/booking?tab=packages` and `?tab=sessions` inline into Setup → Services and Setup → Availability. Kill the top-level `/dashboard/booking` route. Per the stashed dashboard-plan-rewrite if that PR merges; otherwise subset of it.

**S2.5 — Legal pages** — 🤖 Claude (draft) + 👤 Gili (review).
  - `/terms` — ToS drafted via ChatGPT + Termly template (per F1)
  - `/privacy` — Privacy Policy same
  - `/refund-policy` — 30-day money-back on Pro subscriptions; per-producer session cancellation policies (per E4)
  - Cookie consent banner — simple self-built, accept/reject (per F2). ~100 lines.
  - All four pages linked from site footer.

**S2.6 — Autopilot v1 scope** — 🤖 Claude.
  - Hide the 3 stub toggles behind "Coming soon" disabled UI rows in Setup → Autopilot (per PRD §15.1).
  - Verify the 2 working toggles (welcomeEmail, commentNotify) fire correctly end-to-end via integration tests.
  - DB columns stay — just UI gating.

### Phase 2 DoD

- ✅ `/join/<slug>` is feature-complete per PRD §6 (all 6.1-6.6)
- ✅ Every email trigger from PRD §14 actually sends
- ✅ Sentry captures errors; PostHog captures the 10 events; p0 paging configured
- ✅ Setup is single-page with 7 tabs, every tab full inline, no cross-links
- ✅ Four legal pages live in production
- ✅ Autopilot UI shows 2 working toggles + 3 "Coming soon"
- ✅ `pnpm test` green, `docs-audit` clean, `session_recap.md` checkpoint run

### Dependencies

- S2.2 (Resend) depends on `send.skitza.app` DNS (already done)
- S2.3 (PostHog) needs `NEXT_PUBLIC_POSTHOG_KEY` env var on Vercel
- S2.5 (legal) depends on 👤 Gili reviewing ToS/Privacy draft

### Risks

- **S2.1 is a Large BMAD on its own.** If estimates blow, cut S06 engagement-approval to Phase 5 (still works via "approve manually in Today").
- **Resend daily-send limits** on free tier (100/day). Upgrade to $20/mo tier if volume spikes in beta.

---

## Phase 3 — Producer #0 + first content (May 8–14, 1 week)

**Goal:** Gili's own `/join/gili-asraf` is production-grade and the content engine has its first piece. This is what beta producers see when evaluating Skitza.

### Stories

**S3.1 — Upload 3-5 real tracks to Gili's portfolio** — 👤 Gili. Replace `Untitled Project.wav` placeholders with finished work. WAV or MP3, under 100 MB each (PRD §21).

**S3.2 — Flag the 3 best as `is_public_sample=true`** — 👤 Gili. From the producer-side toggle.

**S3.3 — Upload bio + professional photo** — 👤 Gili. Confirm they're final (not placeholder).

**S3.4 — Logo redesign** — 👤 Gili owns vendor choice. Options: Fiverr (~$50, 3-day turnaround) / friend who designs / AI-generated with iteration. 🤖 Claude prepares the brief (what the mark should convey: "one app, solo producer, confident, warm").

**S3.5 — Polish landing page copy** — 🤖 Claude drafts → 👤 Gili edits → 🤖 Claude ships. Anchor on the PRD §28.1 elevator pitch. 5-8 sections max: hero / problem / product / pricing / testimonials (placeholder for now) / FAQ / CTA.

**S3.6 — First Instagram reel script** — 🤖 Claude drafts → 👤 Gili records. "How I use Skitza in my own studio" — 60-90 seconds, screen-recording + voiceover.

**S3.7 — End-to-end smoke test on Gili's profile** — 🤖 Claude. Open an incognito browser, visit `/join/gili-asraf`, play a sample, click Sign Up, complete signup with a test email, land on welcome splash, book a session, get through to payment. Capture any bugs → fix before Phase 4.

### Phase 3 DoD

- ✅ `/join/gili-asraf` looks like what we want beta producers to model
- ✅ Logo is final (or "good enough and signed off")
- ✅ Landing page copy is final
- ✅ First reel is recorded (not necessarily posted — scheduling is Phase 5)
- ✅ End-to-end smoke test passes with zero manual intervention (beta milestone criterion — C2)
- ✅ `session_recap.md` checkpoint run

### Dependencies

- All blocked on 👤 Gili's time. If his week is short, S3.6 (reel) slips to Phase 5 without breaking anything else.

### Risks

- **Gili doesn't have time to upload tracks.** Mitigation: make it a 30-min single-sitting task, not a sprawling multi-session thing. Pick 3 tracks, upload, done.
- **Logo turnaround > 1 week.** Mitigation: AI-generated placeholder iterated until a real logo lands. PRD says brand colors are already locked.

---

## Phase 4 — Beta cohort (May 15–28, 2 weeks)

**Goal:** 5 real producers using Skitza with real artists. First paid booking end-to-end.

### Stories

**S4.1 — Write beta DM template** — 🤖 Claude drafts (personalization slots) → 👤 Gili personalizes + sends. Message structure:
  - Warm opener (why this specific producer)
  - Problem statement (admin pain — match PRD §1)
  - Ask (try the product for 2-4 weeks, pay-what-you-want)
  - Low-friction next step (one DM reply = they're in)

**S4.2 — DM the 5 producers** — 👤 Gili. One by one, spaced over 2-3 days.

**S4.3 — Schedule + run 5 onboarding calls** — 👤 Gili does the calls. 🤖 Claude prepares a 15-bullet checklist (what to cover: profile setup, first service, first availability block, Stripe setup, share link demo).

**S4.4 — Create WhatsApp group with the 5** — 👤 Gili (plus Gili is member #6). Name: "Skitza Beta" or similar.

**S4.5 — Weekly Monday 30-min group call cadence** — 👤 Gili hosts. 🤖 Claude prepares agenda template (3 min retrospective + 12 min product feedback + 12 min strategy + 3 min next week).

**S4.6 — "Pay what you want" Pro signup flow** — 🤖 Claude. Beta producers see a custom Pro checkout with a price input field instead of the fixed $29. Stores the submitted price. Flag: only applies to the 5 beta user IDs. Grandfather logic in same check.

**S4.7 — 5 betas each share `/join` with 1-2 artists** — 👤 Gili coaches the betas via WhatsApp. Goal: at least 10 real artist signups across the 5 beta studios in the 2-week window.

**S4.8 — First paid booking end-to-end** — emergent milestone (not a single-owner story). When this happens, Phase 4 DoD criterion trips.

### Phase 4 DoD

- ✅ 5 beta producers have completed onboarding wizard
- ✅ Each beta has ≥ 1 artist signed up via their `/join` link
- ✅ At least one full "artist books → pays → producer delivers → paid offline" loop closed end-to-end (the milestone that ends the beta per C2)
- ✅ Weekly call happening on schedule
- ✅ WhatsApp group active
- ✅ Zero p0 bugs open in Sentry during the window
- ✅ `session_recap.md` checkpoint run after the milestone

### Dependencies

- Massively 👤 Gili time. This is where founder-grind happens.
- 🤖 Claude is on-call for bug fixes during the 2-week window — p0 bugs get fixed same-day.

### Risks

- **Fewer than 5 producers say yes.** Mitigation: have a backup list of 10; DM batch 2 if batch 1 yields < 5.
- **No artist signups despite producer sharing.** Mitigation: investigate with the producers on weekly calls — is the share link failing? Is the `/join` page unclear? Is pricing wrong?
- **The first paid booking doesn't happen inside 2 weeks.** Mitigation: Phase 4 end-date slips but Phase 5 can start in parallel (marketing prep).

---

## Phase 5 — Launch + Stripe Connect (May 29 – Jun 18, 3 weeks)

**Goal:** Real money flows through the platform. Skitza is publicly launched.

### Stories

**S5.1 — עוסק פטור registration** — 👤 Gili visits Mas Hachnasa (Israeli tax authority) and registers as a sole trader with the "עוסק פטור" (exempt self-employed) classification. Required before Stripe Connect Express onboarding can fire.

**S5.2 — Stripe Connect Express onboarding — real API** — 🤖 Claude. Replace the stub in Setup → Connections with the real Connect Express onboarding flow. Webhook handlers for `account.updated`, `charge.succeeded`, `payout.paid`. Destination charges with 5% platform fee (PRD §12). Covered by integration tests.

**S5.3 — First real paid booking** — emergent. Existing beta producer makes their first real Connect-routed booking. This retires the "Mark paid offline" fallback as the default.

**S5.4 — Status page live** — 🤖 Claude. BetterStack or Instatus free tier. Subdomain `status.skitza.app` (DNS already points at Vercel; just configure subdomain on BetterStack). Monitors: homepage 200, `/api/health` 200, Stripe webhook endpoint 200.

**S5.5 — Public changelog live** — 🤖 Claude. `skitza.app/changelog` auto-generated from PR titles via GitHub Actions post-merge. Also shown in-app as "What's new" dropdown in the notification bell.

**S5.6 — Soft launch on Instagram** — 👤 Gili posts from his IG (network first, per PRD §28.5). 🤖 Claude drafts the post copy.

**S5.7 — Product Hunt launch** — 👤 Gili submits (day 7 after soft launch). 🤖 Claude prepares: gallery images, description, first-comment script, Upvote Day plan.

**S5.8 — Weekly content rhythm established** — 👤 Gili records, 🤖 Claude drafts scripts. Target: 1 IG reel + 1 blog post per week + 1 YouTube walkthrough by end of the 3-week phase.

### Phase 5 DoD

- ✅ Gili is registered עוסק פטור
- ✅ Stripe Connect Express flow works end-to-end — at least one real `charge.succeeded` event fires with 5% fee collected
- ✅ `status.skitza.app` is live and green
- ✅ `skitza.app/changelog` is live with > 3 entries
- ✅ IG soft-launch post is live
- ✅ Product Hunt launch day executed (not necessarily won — just executed)
- ✅ At least 3 content pieces published in the 3-week window
- ✅ `session_recap.md` checkpoint run

### Dependencies

- **S5.1 (עוסק פטור) gates S5.2 (Stripe Connect real).** No Connect without tax registration. If Gili can't get to Mas Hachnasa in Week 5, S5.2 slips — and revenue generation slips with it. This is the single biggest risk to the July deadline.

### Risks

- **עוסק פטור registration takes >1 week.** Mitigation: Gili schedules the visit during Phase 4 (advance the date).
- **Product Hunt launch underwhelms.** Acceptable — PH is a bonus, not the primary channel. IG + content is the core GTM.
- **Stripe Connect requires additional KYC docs Gili doesn't have.** Mitigation: research what's needed BEFORE S5.1 so the Mas Hachnasa visit knocks out the paperwork in one shot.

---

## Phase 6 — Revenue sprint (Jun 19 – Jul 10, 3 weeks)

**Goal:** 100 paying producers by July 10. Breakeven achieved. Decide whether to raise or continue bootstrap.

### Stories

**S6.1 — Scale IG DM outreach** — 👤 Gili. Target 10-20 producers/week DM'd. 🤖 Claude maintains an outreach tracker sheet (who was contacted when, who responded, who signed up, who converted to paying).

**S6.2 — Monitor churn signals** — 🤖 Claude. From PostHog events: which signups don't complete onboarding? Which producers never hit `producer_first_service_created`? Which bail at Stripe Connect? Weekly digest report to Gili.

**S6.3 — Iterate on top 2-3 churn points** — 🤖 Claude runs small BMAD Standard tracks on each.

**S6.4 — Apply the 3 hidden Autopilot stubs** — 🤖 Claude. Now that revenue is flowing, wire `unpaidReminder` + `requestTestimonial` + `autoArchive`. Each is ~1 day: Vercel cron job + email template + tests. Un-hide the 3 UI toggles on Setup → Autopilot.

**S6.5 — Hit 100 paying producers** — emergent. Track daily in a dashboard (PostHog funnel `artist_signup_started → booking_confirmed → payment_succeeded`).

**S6.6 — Revenue decision point** — 👤 Gili. July 10 review:
  - If MRR < $500: pivot conversation — what did we learn, what do we change?
  - If MRR $500-$2k: continue bootstrap, adjust strategy
  - If MRR > $2k: evaluate seed-raise posture (per PRD §28.8)
  - If MRR > $5k: start seed conversations

### Phase 6 DoD

- ✅ 100 paying producers OR honest post-mortem on why not (the latter triggers replan)
- ✅ All 5 Autopilot toggles now functional and visible
- ✅ Weekly content cadence maintained
- ✅ Stripe Connect collecting platform fees on real bookings
- ✅ Gili has made the revenue decision (bootstrap / seed / pivot)
- ✅ `session_recap.md` checkpoint run

### Dependencies

- **S6.1 scales only if Phase 5 landed solid.** No point DM'ing new producers if the core loop is buggy.

### Risks

- **< 100 paying producers by July 10.** Acceptable if trajectory is positive (MRR growing MoM). Re-plan for an extended runway.
- **Content creation drags Gili's time from outreach.** Mitigation: if forced to choose, prioritize outreach. Content is long-tail; DMs convert in days.

---

## Cross-phase concerns

### Hidden in every phase — the "always-on" work

These don't get their own stories but need to happen continuously:

- **`/docs-audit`** on every PR — catch docs drift early
- **`/checkpoint`** after every PR merge or phase DoD — keep `session_recap.md` current
- **Sentry triage** — any p0 gets same-day fix (PRD §22.2b)
- **Beta feedback** — every inbound DM / WhatsApp message gets acknowledged < 4 hours during waking hours
- **CLAUDE.md mistake log** — any time we get burned, add a dated entry

### BMAD per phase

Each phase IS a BMAD Large track. The BMAD skill (once `feat/bmad-skill` merges in Phase 1) should auto-fire the moment a phase kicks off:
1. Analyst: re-confirm the phase's assumptions still hold
2. PM: any PRD deltas this phase needs
3. Architect: how the stories fit together
4. SM: story breakdown (already drafted above — SM re-reviews)
5. Dev: execute via subagents
6. Ship: DoD verification + session_recap checkpoint

### Rollback / replan triggers

The plan re-writes itself if any of these trip:

- **A phase runs > 3 days over its window**
- **A core assumption in Round 2 answers becomes false** (e.g., runway gets tighter, beta count drops to 2, etc.)
- **Launch deadline slips past July 31, 2026**
- **A security incident or data loss happens**
- **Gili explicitly says "let's re-plan"**

Trigger → new Analyst pass → new plan in `docs/plans/active/`.

---

## Launch timeline summary

| Phase | Weeks | Dates | Gate |
|---|---|---|---|
| 1 — Unblock | 0.5 | Apr 21–23 | All 4 PRs landed, clean main |
| 2 — Product polish | 2 | Apr 24–May 7 | Feature-complete for beta |
| 3 — Producer #0 + content | 1 | May 8–14 | `/join/gili-asraf` production-grade |
| 4 — Beta cohort | 2 | May 15–28 | First paid booking end-to-end |
| 5 — Launch + Stripe | 3 | May 29–Jun 18 | Real money flowing |
| 6 — Revenue sprint | 3 | Jun 19–Jul 10 | 100 paying producers (breakeven) |

**Total: ~11.5 weeks.** Built-in slack: ~3 days before the plan re-writes itself. Target revenue date matches Round 2 D1 runway constraint.

---

## What success looks like (July 10, 2026)

- ✅ 100+ paying producers on Skitza
- ✅ ~$2,900+ MRR (at $29 Pro price point)
- ✅ 5% platform fee collected on real Stripe Connect bookings
- ✅ 5 beta producers grandfathered into their free-forever tier, happy
- ✅ Weekly content rhythm proven sustainable
- ✅ Skitza is Gili's full-time thing, not a side project

Whatever happens, on July 10 we checkpoint + decide. Either way, this plan closes.

---

## First move

After this PR (#19) merges:

1. 👤 Gili: review + merge PR #18, #17, #19 in that order.
2. 🤖 Claude: as soon as those are on main, start executing **Phase 1 S1.5** (rebase feat/join-flow on main, push + PR #20). Everything else in Phase 1 flows from there.

If Gili is ready to start Phase 1 **right now**, we skip the PR #19 review cycle and just start.
