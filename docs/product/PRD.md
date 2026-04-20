# Skitza — Product Requirements Document

> This is the source of truth for product decisions. When the PRD and an
> implementation plan disagree, the PRD wins. Update this file BEFORE building
> a feature, not after. Open questions are tagged `<!-- Q: ... -->` — these
> need human decisions before implementation.
>
> **Last updated:** 2026-04-20 by the dev-workflow foundation pass.

---

## 1. Vision

**Skitza is the one app a solo music producer opens in the morning.**

It replaces the Calendly + Samply + Notion + DocuSign + Stripe + WhatsApp stack
with a single product. The producer's job is to make music with artists; Skitza's
job is to handle everything else — scheduling, contracts, deposits, file review,
final payment, portfolio, CRM — automatically where possible, one tap where not.

### The core product promise

> **One permanent link in your Instagram bio. Artists click, listen, sign up,
> and book — with zero manual client entry on your end.**

Everything downstream — contracts, invoices, project tracking, deliverables —
materializes automatically from that first booking. The producer configures once
and runs on autopilot.

---

## 2. Personas

### 2.1 Producer (primary persona)

**Who:** Independent solo music producer. Makes a living from 5-20 active projects
at a time. Works across multiple artists, often mixing + mastering + production.
Currently juggles 5+ apps. Lives on Instagram / TikTok for discovery.

**Core needs:**
- Look professional on a first-touch link
- Never manually enter client info
- Never chase payment manually
- See today's priorities at a glance
- Keep music + feedback + contracts + money per-project in one place
- Work from anywhere (desktop + mobile)

**Job-to-be-done:** "Replace my admin toolchain so I can spend all my time making music."

### 2.2 Artist (secondary persona — "client")

**Who:** The producer's customer. A vocalist, rapper, band, label A&R, or indie
artist looking for production / mixing / mastering services. Discovers producers
via Instagram, TikTok, Spotify credits, word of mouth.

**Core needs:**
- Hear the producer's work before committing
- Book a session with clear expectations (price, duration, deliverable)
- Leave timestamped feedback on tracks
- See project status in one place
- Pay easily, on a schedule that works

**Job-to-be-done:** "Work with this producer without needing a 12-message DM negotiation."

---

## 3. Guiding principles

1. **Share-first, not create-first.** Producers share ONE link; everything else cascades automatically.
2. **Autopilot over configuration.** Smart defaults + named toggle switches over rule builders.
3. **One screen per job.** 4 dashboard screens, never 10. Setup is one page with tabs, not 8 pages.
4. **Progressive onboarding.** Artists browse without signup, sign up when they want to interact.
5. **Mobile = first-class.** If it doesn't work at 360px with thumbs, it doesn't ship.
6. **Native-app feel.** No card-in-white-box UI. No webform-style layouts. Samply × Spotify benchmark.
7. **English default, opt-in translation.** Only the authenticated app is translated. Landing is English, always.

---

## 4. The 4 Producer screens

### 4.1 Today (the cockpit)

`/dashboard` — the landing page after sign-in.

**What renders:**
- **ShareLinkCard** (prominent) — producer's permanent `skitza.app/p/<slug>` with one-click copy + preview
- **QuickActions strip** (8 actions, 2 rows): Copy share link / Upload track / New booking / Send invoice + ⌘K search / Add offline client / Quick note / Preview public page
- **4-KPI strip**: Active projects, Revenue this month, Sessions next 7 days, Unresolved items
- **Revenue trend** (6-month SVG line graph)
- **Split-inbox**: unified list of actionable items (sessions + comments + invoices + leads), sorted by urgency, with a detail pane on desktop / stack on mobile
- **Setup-nudge banner** (first-run): if producer skipped onboarding + has no packages configured + inbox is empty, show "Finish setup" CTA

**Empty-state guidance:** if the inbox is empty, headline is "All caught up" + ShareLinkCard stays visible.

### 4.2 Projects

`/dashboard/projects` (list) + `/dashboard/projects/<id>` (Project Room).

**List view (`/dashboard/projects`):**
- Chip filter bar: **All / Live / Done / Archived** (4 chips, derived from the 9-value stage enum via `stageToState()`)
- Each row: title / artist / stage badge / relative time
- Security: server strips `shareTokenHash` + Stripe fields before sending to client

**Project Room (`/dashboard/projects/<id>`):**
- Header: avatar + client name + stage badge + PaymentStatusStrip + 3-dot actions menu
- 5-step timeline: Trial → Contract → In Progress → Final → Paid (derived from project state via `computeTimeline()`)
- 4 sub-tabs:
  - **Music**: tracks / versions / comments / upload (the bulk of interaction)
  - **Sessions**: the linked booking (1:1 per schema) with Reschedule/Cancel stubs
  - **Money**: Paid/Outstanding/Next + Open in Stripe link + Contract (read-only signed summary)
  - **Notes**: Overview stats + Activity timeline

### 4.3 Music (cross-project library)

`/dashboard/music` — Spotify-style cover-art grid of every track across every project,
sorted by upload recency (100-row cap). Tapping a card deep-links to
`/dashboard/projects/<id>?tab=music&version=<versionId>`. Empty state nudges to Projects.

### 4.4 Setup

`/dashboard/settings` — single page with 7 tabs. **Every tab renders its full
management UI inline.** No cross-link cards, no "configure this elsewhere" stubs.

Tabs:
1. **Profile** — display name, slug, bio, logo, brand color
2. **Services** — full CRUD of services (products) + 5 template quickstart
3. **Portfolio** — track upload + reorder + delete (for the public `/p/<slug>` page) <!-- Q: full inline management required -->
4. **Availability** — duration presets + multi-window-per-day + auto-confirm toggle + cancellation policy + GCal sync status <!-- Q: full inline management required -->
5. **Autopilot** — 5 toggle switches (welcome email / unpaid reminder / testimonial / comment notify / auto-archive)
6. **Connections** — Stripe Connect onboarding + Calendar (GCal stub)
7. **Account** — email (via Clerk), language switcher, delete account, replay onboarding tour

**Navigation:** URL-driven via `?section=<key>`. Default tab is `profile`. Back button returns to Today.

---

## 5. The 4 Artist app tabs

`/artist` (authenticated artist side — scoped to the studios the artist interacts with).

1. **Home** — overview of active projects across studios; most-recent activity
2. **Music** — tracks the producer shared, with timestamped feedback
3. **Book** — book sessions (per-studio)
4. **Store** — paid products + session add-ons

Plus: `StudioSwitcher` for artists working with multiple producers, `SoftSignInBanner`
on public surfaces, `PersistentMiniPlayer` across tabs.

---

## 6. The artist onboarding flow — THE critical UX

This is the #1 unresolved area in the product. User has corrected my understanding
3+ times. Documenting the intent as I currently understand it + open questions.

### 6.1 Current intent (per user, 2026-04-20)

> "When I send a new customer a link, I want him to sign in to the app, basically
> to give him the artist side. Right now it simply opens the producer landing
> page."

And earlier:

> "I want him to sign up and become a client, he listens on his own to my songs
> and books a session, I only guide him in the app first time if he needs help."

### 6.2 What this implies

- The shared link should NOT land visitors on the Skitza marketing site (`/`).
- The shared link should NOT require sign-up before previewing anything.
- The shared link SHOULD push visitors toward signing up as artists on the authed side.
- Once signed up, the artist lands in `/artist` with THIS producer attached as a studio.
- Their new-user experience is "a demo where the screen shows where to click with little explainers" (per user).

### 6.3 Open questions for the next product session

<!-- Q1: What URL does the producer copy from Today? Is it `/p/<slug>` (current), `/invite/<slug>`, `/join/<slug>`, or something else? -->
<!-- Q2: On click, does the first screen the visitor sees render the producer's portfolio (music + bio), or a branded sign-up splash, or a hybrid (teaser + sign-up CTA)? -->
<!-- Q3: After the artist signs up, where do they land? `/artist` home with the producer auto-attached? A welcome carousel? Straight into a booking flow? -->
<!-- Q4: Should the artist be able to browse ALL the producer's music pre-signup, or only a teaser (1-2 tracks) with "sign up to hear the rest"? -->
<!-- Q5: If the artist already has a Skitza account with other producers, should clicking the link auto-attach THIS producer as a new studio, or ask for confirmation? -->
<!-- Q6: Should the producer have an alternate "generate a trackable magic link for this specific outreach" option (for when they're DMing a specific client and want view analytics), OR is that scope creep? -->

### 6.4 Guardrails (already decided)

- **No manual "add client" form in the common case.** Artist sign-up + booking auto-creates the `client_contacts` + `projects` row.
- **Clerk is the auth layer** (already wired; artist webhook stamps `client_contacts.clerk_user_id`).
- **No arbitrary-data requirement pre-signup.** The producer doesn't need to pre-enter the artist's name/email to share the link.

---

## 7. Autopilot (the automation layer)

5 named toggle switches on Setup → Autopilot. No rule builder, no if/then UI.

| Toggle | What it does | Default |
|---|---|---|
| Send a welcome email when a booking lands | Confirms the booking to the artist with session details | OFF |
| Remind about unpaid invoices after 7 days | Cron-driven; auto-pings the artist | OFF |
| Ask for a testimonial when a project completes | On stage → 'paid', sends testimonial request | OFF |
| Ping me when an artist comments | Notification on `trackComments` insert from artist side | ON |
| Auto-archive projects 30 days after final payment | Stage → 'archived' automatically | OFF |

**Technical:** 5 boolean columns on `producers`. Event-driven hooks check the flag
and act or don't. Cron-driven ones (unpaid reminder, testimonial, auto-archive)
need Vercel Pro for daily crons (Hobby is 24h minimum but sufficient for these).

---

## 8. Payments

### 8.1 Architecture

- **Stripe Connect Express** — producer onboards once, money flows to their account
- **Destination charges** — platform is merchant of record, producer is the beneficiary
- **Subscription Schedules** for recurring installment plans (50-50 or N-month)
- **Stripe Tax** enabled per Connect account for global compliance
- **Webhook idempotency** via the `webhook_events` table

### 8.2 Payment plans

Three kinds per product:
- **Flat** — pay in full on booking
- **50/50** — 50% on booking, 50% on final delivery (producer charges final)
- **Monthly** — N monthly installments via Subscription Schedule

Calculated via pure helpers in `apps/web/src/server/payments/plan.ts`:
- `calculateCharges(plan, totalCents): number[]` — remainder on first charge
- `advancePlanState(state, event)` — state machine

---

## 9. Non-goals (HARD constraints)

These are explicitly NOT built and NOT on the near-term roadmap.

| Feature | Why not | User quote / source |
|---|---|---|
| AI Copilot / LLM calls | No API-key dependency right now | 2026-04-20 |
| Voice-first capture + transcription | Same — needs API | 2026-04-20 |
| Auto-generated social content | Tracks are internal; artists distribute via DistroKid | 2026-04-20 |
| Producer referral network | Not now | 2026-04-20 |
| framer-motion or similar JS animation libs | CSS-only is enough + zero bundle cost | Batch C decision |
| Custom domain support | Future paid tier | Founding plan |
| Beat licensing | Different business model | Founding plan |
| Multi-engineer / team mode | v1 is solo producers only | Founding plan |
| Native iOS/Android | PWA + Tauri for now | Founding plan |

---

## 10. Global concerns

### 10.1 Internationalization

- **Scope: authenticated app only.** Landing, public portfolio, sign-in/sign-up, magic-link handler are English-only, LTR-only.
- **Default locale: English for everyone.** No IP-based auto-detection.
- **Hebrew is opt-in** via language chip in sidebar footer. Cookie-persisted.
- Translation file: `apps/web/messages/{en,he,ar}.json`. Arabic is stubbed for future.

### 10.2 Mobile

- Producer gets a 4-tab bottom nav + center "+" FAB (mirrors artist app pattern).
- Every interactive element ≥ 44×44 tap target on mobile.
- iOS safe-area respected (no overlap with home indicator or Dynamic Island).
- Momentum scrolling on horizontal rails.

### 10.3 Accessibility

- `aria-current="page"` on active nav items (not `aria-pressed`).
- ARIA tab/panel IDs always paired: `tab-<key>` ↔ `panel-<key>`.
- `aria-live="polite"` on dynamic lists (Today inbox, notification bell).
- Skip-to-content link in AppShell.
- Every primitive animation respects `prefers-reduced-motion: reduce`.

### 10.4 Performance

- Single-round-trip tRPC aggregations on screen loads (Today, Project Room, Artist Home).
- Producer-scoping in every WHERE clause — no cross-tenant queries.
- R2 multipart uploads for large audio files (up to 3 hours).

---

## 11. Tech-stack commitments (locked)

See `CLAUDE.md` for the full rundown. Highlights:

- Next.js 15 App Router
- tRPC v11
- Drizzle 0.36 + Neon Postgres
- Clerk v7
- Stripe Connect Express
- Cloudflare R2
- Tailwind v4 + CSS vars
- Vitest

**No swaps without PRD update.**

---

## 12. Open product questions (for the next Socratic session)

Tagged above with `<!-- Q: -->`. Consolidated list:

1. **Artist link URL shape**: `/p/<slug>` vs `/invite/<slug>` vs `/join/<slug>` vs unchanged
2. **First screen for link visitor**: portfolio / sign-up splash / hybrid
3. **Post-signup landing**: home / welcome carousel / booking flow
4. **Music preview gating**: full catalog pre-signup or teaser only
5. **Existing-account attach**: auto-attach or confirm
6. **Trackable magic link variant**: ship or defer
7. **Custom domain**: tier/timeline
8. **Pricing tiers**: locked-in structure + limits per tier

---

## 13. Appendix: things the team has learned (mistake tips)

Tied to `CLAUDE.md`'s mistake log — summarized for product decisions:

- **Don't fork UX decisions into multiple surfaces.** When I built "cross-link cards" on Setup pointing to deleted pages, it created dead ends. Every tab must render its full UI inline.
- **Don't auto-detect when explicit opt-in is clearer.** IP-based locale defaulted Israeli users to Hebrew with no landing-page switcher to undo it. Fix: English default, opt-in.
- **Don't expose database enums directly to UI.** Stages have 9 values in the DB; UI shows 3 derived states. Bridge via `lib/` helpers.
- **Plans fabricate data model details.** Always verify enums + FK semantics against `packages/db/src/schema.ts` before implementing.

---

*End of PRD v1. Updates go through the same PR process as code — with a reviewer.*
