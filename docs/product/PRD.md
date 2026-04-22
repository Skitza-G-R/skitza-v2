# Skitza — Product Requirements Document (v2)

> This is the source of truth for product decisions. When the PRD and an
> implementation plan disagree, the PRD wins. Update this file BEFORE building
> a feature, not after.
>
> **v2 status**: 70+ product decisions locked in via Socratic Q&A sessions on
> 2026-04-20. No `<!-- Q: -->` tags remain.
>
> **Last updated:** 2026-04-20 by PRD v2 pass (dev-workflow branch).

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

### 2.1 Producer (primary)

Independent solo music producer. Makes a living from 5-20 active projects at a
time. Works across multiple artists — mixing + mastering + production. Currently
juggles 5+ apps. Lives on Instagram/TikTok for discovery.

**Job-to-be-done:** "Replace my admin toolchain so I can spend all my time making music."

### 2.2 Artist (secondary — "the client")

The producer's customer. Vocalist, rapper, band, label A&R, or indie artist
looking for production services. Discovers producers via Instagram, TikTok,
Spotify credits, word of mouth.

**Job-to-be-done:** "Work with this producer without needing a 12-message DM negotiation."

---

## 3. Guiding principles

1. **Share-first, not create-first.** Producers share ONE link; everything else cascades automatically.
2. **Autopilot over configuration.** Smart defaults + named toggle switches over rule builders.
3. **One screen per job.** 4 dashboard screens, never 10. Setup is one page with tabs.
4. **Progressive onboarding.** Artists browse a teaser without signup; sign up to unlock full access.
5. **Mobile = first-class.** 360px + thumbs first. Also: Tauri Mobile reuses the web codebase for real native apps.
6. **Native-app feel.** No card-in-white-box UI. Samply × Spotify × Notion benchmark.
7. **English default, opt-in translation.** Only the authenticated app is translated. Landing is English, always.
8. **No AI dependency (for now).** No API keys required to run Skitza.
9. **Skitza subdomains only.** No custom-domain feature. Ever.

---

## 4. The 4 Producer screens

### 4.1 Today (the cockpit)

`/dashboard` — the landing page after sign-in.

**What renders:**
- **ShareLinkCard** — permanent `skitza.app/join/<slug>` with one-click copy + preview
- **QuickActions strip** (8 actions, 2 rows): Copy share link / Upload track / New booking / Send invoice + ⌘K search / Add offline client / Quick note / Preview public page
- **4-KPI strip**: Active projects / Revenue month / Sessions next 7 days / Unresolved items
- **Revenue trend** (6-month SVG line graph)
- **Aggregate visitor analytics** — 30-day `/join/<slug>` visits, top-played tracks, conversion rate (visits → bookings)
- **Split-inbox**: unified list of actionable items (sessions + comments + invoices + leads), sorted by urgency, detail pane on desktop / stack on mobile
- **Setup-nudge banner** (first-run): "Finish setup" CTA if onboarding skipped + inbox empty

### 4.2 Projects

`/dashboard/projects` (list) + `/dashboard/projects/<id>` (Project Room).

**List view**: chip filter bar **All / Live / Done / Archived** derived from the 9-value stage enum via `stageToState()`. Rows show title / artist / stage badge / relative time.

**Project Room**: header with avatar + client name + stage badge + PaymentStatusStrip + 3-dot actions + tag pills (`#warm-vocals`). 5-step timeline: Trial → Contract → In Progress → Final → Paid. 4 sub-tabs:

- **Music** — tracks / versions / comments / upload
- **Sessions** — all linked bookings (one project can have many bookings — see §11)
- **Money** — Paid/Outstanding/Next + "Open in Stripe" + Contract (read-only signed summary)
- **Notes** — Overview stats + Activity timeline

### 4.3 Music

`/dashboard/music` — Spotify-style cover-art grid of every track across every project, sorted by upload recency (100-row cap). Tapping a card deep-links to its Project Room's Music sub-tab.

### 4.4 Setup

`/dashboard/settings` — single page with 7 tabs. **Every tab renders its full management UI inline.** No cross-link stubs.

1. **Profile** — display name, slug, bio, logo, brand color
2. **Services** — full CRUD + 5 template quickstart (see §8)
3. **Portfolio** — track upload + reorder + delete (for public `/join/<slug>`)
4. **Availability** — duration presets + multi-window-per-day + auto-confirm + cancellation policy + GCal sync status
5. **Autopilot** — 5 toggle switches
6. **Connections** — Stripe Connect onboarding + Google Calendar OAuth
7. **Account** — email (via Clerk), language switcher, delete account (30-day grace), replay onboarding tour

### 4.5 Producer first-run onboarding wizard

New producers who sign up hit a **5-step wizard** before the dashboard is fully usable. Skippable in one click (the Setup-nudge banner re-prompts any skippers on Today). Each step is a single screen with one clear action.

1. **Profile** — slug (pre-filled from Clerk display name, editable), display name, bio, logo upload, brand color picker
2. **Portfolio** — upload at least 1 portfolio track (drag-and-drop or file picker); this is the minimum viable profile (per Round 2 A2 → slug + name + 1 track)
3. **Services** — pick 1+ service from the 4-category quickstart (Production / Mixing & Mastering / Consulting / Custom) or create a new one; deposit % pre-filled to 30%
4. **Availability** — set weekly windows (default Mon-Fri 10am-6pm) + default session length
5. **Stripe Connect** — "Connect with Stripe" CTA (Connect Express onboarding); **skippable** — producer can share portfolio + accept offline payments without Stripe, but Booking/Services stay locked until Connect is linked (per Round 2 A1)

**Exit criteria**: all 5 steps complete → lands on `/dashboard` (Today) with no nudge. **Partial completion** → Today shows the Setup-nudge banner with "Resume setup" CTA pointing to the first incomplete step.

**"Replay tour" lives in Setup → Account** so returning producers can walk through the flow again.

---

## 5. The 4 Artist app tabs

`/artist` (authenticated artist side — scoped to the studios the artist has joined).

1. **Home** — active projects across studios + most-recent activity + cross-studio notification bell
2. **Music** — tracks producers have shared (full catalog, not just teaser — signed-in gating is behind them)
3. **Book** — per-studio booking surfaces
4. **Store** — paid products + session add-ons

Plus: `StudioSwitcher`, `SoftSignInBanner` on public surfaces, `PersistentMiniPlayer`.

**Artist profile**: edits email (via Clerk), display name, profile photo. That's it — not a full CRM/portfolio tool.

**"My history"**: aggregate view of every project across every attached studio, sorted by recency. One tap from Home.

---

## 6. Artist onboarding — the link flow

### 6.1 The URL

**`skitza.app/join/<slug>`** — permanent, short, IG-bio-friendly. Signals "join [Producer]'s studio." Never expires. No trackable-per-recipient variant (deferred to Phase 2+; surfaced only if producers explicitly ask).

### 6.2 First visit (not signed in)

**Hybrid teaser page** with TWO audio sections:

**Section A — Skitza-uploaded tracks (producer-curated samples):**
- Each track in the producer's portfolio has a boolean `is_public_sample` flag (default `false`)
- Only tracks with the flag `true` play for un-signed-in visitors
- Cap: 3 displayed (if more are flagged, show the 3 most-recently-uploaded)
- Remaining uploaded tracks are visible but locked behind "Sign up to play" overlay

**Section B — external streaming links (always public):**
- Producer can paste URLs from 7 supported platforms: Spotify, Apple Music, YouTube / YouTube Music, SoundCloud, Bandcamp, Tidal, Instagram Reels
- These render as inline embeds (platform-native iframes / oEmbed) — playable without leaving the page
- Stored in a new `producer_external_links` table: `(id, producer_id, platform, url, title, position, created_at)`
- No gating — these tracks are already public on their origin platforms, re-gating makes no sense

**Other page elements:**
- Producer's name, logo, bio
- Prominent "Sign up to hear the full catalog + book a session" CTA
- Social proof: testimonials if any, stage badges
- Footer: "Powered by Skitza" (subtle; see §7 Pricing)

### 6.3 Sign-up flow

Customizable splash (producer edits a single tagline + 1 CTA copy field; everything else templated):

> "Join [Producer]'s studio — sign up to hear their full catalog + book your first session."

Clerk handles the actual signup (email + password, or social). After signup:

1. **Welcome splash** (1 screen): "You're in — here's [Producer]'s studio. Here's how it works." Brief 3-dot pointer to the bottom nav (Home / Music / Book / Store).
2. Dropped into `/artist` Home with Producer X auto-attached to the artist's Studios.
3. `client_contacts.clerk_user_id` stamped via existing Clerk webhook.
4. No project exists yet — that's created on first booking (auto).

### 6.4 Already-has-account flow

Visitor is already signed in to Skitza with other producers → clicks `/join/<slug>`:

**Confirm modal** (not auto-attach):

> "Add [Producer X]'s studio to your account?"
> [Add studio] [Cancel]

Confirm → Producer X joins the artist's Studios list. No full signup needed.

### 6.5 Engagement approval model

When a signed-in artist clicks "Start [Service]" on `/join/<slug>` (or from their `/artist` app):

1. Skitza creates a **pending engagement** (a project with `stage: 'lead'` and approval state `pending`).
2. Producer gets a notification on Today: "[Artist Name] wants to start [Service Name] — approve?"
3. Producer clicks **Approve** or **Decline** in-app.
4. On approve → artist is shown the payment step (deposit via Stripe Connect, or "Mark paid offline" stub until Connect is live — see §12.3).
5. On payment success → project transitions to `stage: 'booked'` and artist gains access to schedule sessions.

**Inside an approved + paid project, all subsequent session bookings auto-confirm** without producer approval. The Model 2 schema (§9) already supports this — approval happens at the project level, sessions are just bookings rolled under the project.

**No per-service or per-client approval flags for v1.** Every new engagement requires one click. Keep the model simple. If producers complain, add nuance later (per-service "auto-approve" flag, per-client trust toggle).

### 6.6 Legacy `/p/<slug>` URL removal

The old public portfolio route `/p/<slug>` and its public booking sub-route `/p/<slug>/book` are removed. Hitting either returns a 404.

- All artist interaction funnels through `/join/<slug>` + Clerk signup.
- Producer can still access their own public preview via "Preview public page" in QuickActions (which now links to `/join/<slug>`, not `/p/<slug>`).
- Anyone with an old `/p/<slug>` URL (emailed, bookmarked, shared in DMs) gets a 404. Since the product is pre-launch, this is acceptable collateral; post-launch we can add a server redirect if needed.

---

## 7. Pricing — 2 tiers (no Studio tier for launch)

| Tier | Price | Limits | Platform fee | White-label |
|---|---|---|---|---|
| **Free** | $0 | 3 active projects, 5 portfolio tracks, no Autopilot | 30% | Subtle footer + "Powered by Skitza" badge on portfolio tracks |
| **Pro** | $29/mo | Unlimited projects, unlimited tracks, Autopilot enabled | 5% | No Skitza branding |

**No Studio tier at launch.** The original $79/mo tier depended on custom domains (killed in Q7) + team mode (non-goal). If Pro users organically ask for Studio-level features (0% platform fee, priority support, team mode), revisit.

**Payment**: Stripe Connect Express handles tier upgrades via subscription. Producer charged monthly; Skitza takes the platform fee on each producer-to-artist transaction.

### 7.1 Beta pricing (first 5 producers only)

The first 5 beta producers get a **"pay what you want"** flow for Pro — no price lock, just a number field. Purpose: discover real willingness-to-pay before $29 is set in stone for the rest of the market.

After the beta ends (milestone-based — closes when the first paid booking completes end-to-end with zero manual intervention), betas keep their Pro features **free for 6 months** (grandfather window), then transition to the $29 Pro price like everyone else.

New signups after beta close: **$29 Pro** from Day 1. No exceptions without Claude proposing a price change + user ack (per Round 2 D5 autonomy rule).

---

## 8. Services catalog

### 8.1 Structure

3 fixed categories + 1 custom type:

1. **Production**
2. **Mixing & Mastering**
3. **Consulting**
4. **Custom / one-time session** — free-form, producer-defined title, no category

Services live flat within their category. Producer can have as many as they want.

### 8.2 Variants

Each service **starts as a single offering** (default). Producer can opt-in via a toggle to have up to 3 price tiers (Standard / Pro / Premium) for that service. Most services will stay single-tier.

### 8.3 Deposit policy

Producer sets a default deposit % in Availability settings (suggested 30%). Each service can override with its own deposit %.

### 8.4 Visibility

Each service has a **Public / Unlisted** flag. Unlisted services are only bookable via direct URL (useful for VIP quotes).

### 8.5 Service templates (quickstart)

5 built-in templates on the Services tab. Producer clicks → service form pre-filled, edits + saves:

1. 3-hour mixing session ($150, 180 min, single-session)
2. Album production package ($4,500, multi-session, 50/50 split — a "production" service)
3. Weekend intensive ($600, 480 min, flat)
4. Remote feedback round ($75, 60 min, async)
5. Mastering pass ($200, 90 min, single-session)

---

## 9. Project model (Model 2: one project, many bookings)

**Planned schema migration**: flip `project.bookingId` (1:1) → `bookings.projectId` (many-to-1).

A project can have **one OR many bookings**:

- **Single-session services** (most): 1 booking → 1 project. Artist books "3-hour mixing session" once, that creates a project.
- **Production services** (multi-session): 1 project, many bookings. Artist books "Album production package" once → project created. Each subsequent scheduled session is a new booking rolled under that same project.

The "Sessions" sub-tab in Project Room shows ALL bookings associated with that project, sorted by date.

---

## 10. Booking flow

### 10.1 Timezone

Artist picks their timezone during booking; availability displayed in both producer's and artist's timezones. Calendly-standard.

### 10.2 Single-day only

Individual bookings are single-day. Multi-day engagements happen as multiple bookings under one project (Model 2).

### 10.3 Reschedule

Either party can initiate. Artist request → producer approves (or Autopilot auto-approves if toggle is on). Producer can reschedule unilaterally with notice email.

### 10.4 Buffer

Producer-configurable in Availability settings (default 15 min between sessions).

### 10.5 Multi-participant sessions (band sessions)

Single booker, but can add "session participants" — name + email each. Participants receive the calendar invite (.ics) but don't get Skitza accounts. Full multi-artist accounts = future feature.

### 10.6 Artist booking experience

- Picks service → sees availability
- Picks slot → confirms terms inline (§12 Contracts)
- Pays deposit via Stripe
- Project auto-created, artist-accessible immediately in `/artist`

---

## 11. Project Room deep dive

### 11.1 File retention

- **Signed-in artists**: files retained forever (R2 storage).
- **Guest (pre-signup) uploads + comments**: 90-day retention. Visible notice shown to guest artists: "Files expire in 90 days unless you sign up."
- Producer can manually delete any file/comment any time.

### 11.2 Comments

Only the authenticated artist + producer can post comments on tracks. No public/anonymous comments.

### 11.3 Downloads

**Auto-release** when Money = Paid (final payment received). Producer doesn't manually "release" downloads; hitting final-paid flips the bit.

### 11.4 Stems

Stems are uploaded as a **zip file** and presented as a single download on the finished version. Cleaner than per-version-label conventions.

---

## 12. Payments

### 12.1 Architecture

- **Stripe Connect Express** — producer onboards once
- **Destination charges** — platform is merchant of record
- **Subscription Schedules** for installment plans (50-50 or N-month)
- **Stripe Tax** per Connect account for global compliance
- **Stripe handles 1099-K** filing for US producers (zero bookkeeping for you or them)

### 12.2 Payment plans

- **Flat** — pay in full on booking
- **50/50** — 50% on booking, 50% on final delivery
- **Monthly** — N monthly installments via Subscription Schedule

Plans can be **changed mid-project** via "Propose new plan" → artist signs update → old charges preserved, new schedule takes over.

### 12.3 Offline payments

"Mark paid offline" action on any invoice. No Stripe fee, no platform fee, just an audit-trail entry. Covers cash / bank transfer / crypto.

### 12.4 Refunds

Partial refunds supported via a button on paid invoices — fires Stripe refund for any % the producer specifies. Full refunds are just partial = 100%.

### 12.5 Multi-currency

Producer sets a default currency in Setup → Profile. Each service or individual invoice can override. Stripe handles conversion on payout.

### 12.6 Late fees

**Not automated.** Autopilot's "Remind about unpaid invoices after 7 days" toggle handles reminder emails. Manual late-fee application is out of scope until legal review.

---

## 13. Contracts & legal

### 13.1 Contract template

Skitza provides **one standard ToS + Privacy Policy** that applies to all producers. Reviewed annually by legal. Producers don't customize their own.

### 13.2 Contract UX

Auto-generated at booking time. Artist signs inline via a checkbox + typed name (Documenso-backed under the hood; still produces an eIDAS-compliant signed PDF).

### 13.3 E-signature jurisdiction

**US + EU (Simple Electronic Signature)** via Documenso's audit trail. Legally binding for typical producer-artist engagements. Outside US/EU: "legally binding where enforceable" disclaimer — not actively marketed in other jurisdictions.

### 13.4 Signed PDF

Stored immutably in R2 with object-lock. Audit JSON includes IP, user agent, timestamps, document hash chain.

### 13.5 Tax forms

Stripe Connect Express generates 1099-K for US producers above thresholds automatically. Skitza does no tax paperwork.

### 13.6 GDPR — delete my account

Self-serve button in Setup → Account. Triggers:
- 30-day soft-delete grace period (can cancel)
- After 30 days: hard delete of producer record + all projects/tracks/bookings
- Artist records preserved if tied to other studios

### 13.7 COPPA

Age-gate on signup: "Are you 13 or older?" — yes required. Under-13 users refused account. Producers working with minors handle parental consent offline.

---

## 14. Notifications & email

### 14.1 Artist emails (default ON)

1. Booking confirmed
2. Contract ready to sign
3. Final payment due
4. Track version uploaded
5. Producer replied to your comment

**Default OFF** (producer can enable later, or artist can opt-in):

- Session reminder 24h before
- Testimonial request when project completes (tied to Autopilot toggle)
- Monthly recap

### 14.2 Producer emails (default ON)

1. New booking request
2. Payment received
3. New comment from artist
4. Contract signed
5. Booking cancelled or rescheduled

**Default OFF**:

- Daily digest ("3 unread items on Today")
- Weekly revenue summary

### 14.3 Email branding

**"Producer X via Skitza"** — producer's name/logo in the email header, subtle Skitza footer.

Full white-label (no Skitza mention) would be a Studio-tier feature but Studio tier is deferred for launch (§7).

---

## 15. Autopilot (the automation layer)

5 named toggle switches on Setup → Autopilot. No rule builder, no if/then UI.

| Toggle | Default | What it does | Launch status |
|---|---|---|---|
| Send a welcome email when a booking lands | OFF | Confirms the booking to the artist with session details | ✅ **Working** |
| Ping me when an artist comments | **ON** | Notification on `trackComments` insert | ✅ **Working** |
| Remind about unpaid invoices after 7 days | OFF | Cron-driven; auto-pings the artist | ⏳ Stub (hidden at launch) |
| Ask for a testimonial when a project completes | OFF | On stage → 'paid', sends testimonial request | ⏳ Stub (hidden at launch) |
| Auto-archive projects 30 days after final payment | OFF | Stage → 'archived' automatically | ⏳ Stub (hidden at launch) |

### 15.1 Launch scope (Round 2 decision, 2026-04-21)

**Only the 2 working toggles are visible at launch.** The 3 stubs (`unpaidReminder`, `requestTestimonial`, `autoArchive`) ship hidden behind "Coming soon" badges — DB columns retained, UI rows disabled. Wiring them requires a Vercel cron job + email template + tests (~1 day each). Deferred to Phase 2 of the post-launch roadmap (see `docs/plans/active/2026-04-21-post-launch-roadmap.md`) to protect the runway.

**Rationale**: a producer flipping a stub toggle ON and seeing nothing happen is worse for trust than not seeing the toggle at all.

### 15.2 Full vision (once all 5 wire up)

5 boolean columns on `producers`. Event-driven (booking.confirm, trackComment.insert) fire synchronously; cron-driven (unpaid, testimonial, auto-archive) need Vercel Pro cron (minimum 1×/day suffices).

---

## 16. Internationalization

- **Scope: authenticated app only.** Landing, public portfolio, sign-in/sign-up, magic-link handler are English-only, LTR-only.
- **Default locale: English for everyone.** No IP-based auto-detection.
- **Hebrew is opt-in** via language chip in sidebar footer. Cookie-persisted.
- Translation files: `apps/web/messages/{en,he,ar}.json`. Arabic stubbed for future.
- Root `<html>` always `lang="en" dir="ltr"`. RTL applies per-route-group via `<AppI18nProvider>` in authenticated layouts only.

---

## 17. Mobile strategy

### 17.1 PWA (ships with v1)

- `manifest.json` + icons → installable as PWA on iOS 16.4+ / Android
- Offline mode for artists: service worker + IndexedDB caches recently-played tracks (producers don't need offline)
- Push notifications: email-only for v1; PWA push layered on Phase 2

### 17.2 Native apps via Tauri Mobile

- **Ship in parallel with v1** or shortly after (not Phase 3 — prioritized)
- Tauri Mobile reuses the existing web codebase (~70%), avoids rewriting in Swift/Kotlin
- Targets iOS App Store + Google Play Store
- Fallback plan: if Tauri Mobile blocks on store review, ship PWA-only + revisit in Phase 3

### 17.3 Producer mobile web

- 4-tab bottom nav (Today / Projects / Music / Setup) + center "+" FAB for QuickActions
- 44×44 tap targets everywhere
- iOS safe-area insets respected
- Momentum scrolling on horizontal rails

---

## 18. Integrations

### 18.1 Google Calendar — ship now

Real OAuth integration. Two-way sync: Skitza bookings appear in the producer's Google Calendar; existing busy-times in Google Calendar block availability in Skitza.

### 18.2 iCal / .ics

Every booking confirmation email includes an `.ics` attachment for the artist to add to Apple/Google Calendar.

### 18.3 Video meetings (Zoom / Meet)

**Producer pastes their own link** in service config. Skitza includes it in booking confirmation emails. No OAuth to Zoom/Google Meet.

### 18.4 Deferred

- **Webhooks out / Zapier / n8n**: Defer. Autopilot + built-in emails cover 80% of automation; revisit after launch.
- **Mailchimp / email capture export**: Defer.

### 18.5 Never

- **DAW integrations** (Ableton, Logic, Pro Tools): out of scope forever. Too fragmented; not Skitza's moat.
- **Beat licensing platforms**: different business model.

---

## 19. Analytics & data

### 19.1 Producer sees (aggregate only)

- 30-day `/join/<slug>` visit count
- Top-played tracks on public portfolio
- Conversion rate (visits → bookings)
- Revenue trends (already shipped: 6-month SVG line chart on Today)

**No individual visitor IPs, user agents, or session recordings.** Privacy-first.

### 19.2 Artist sees

**Nothing about the producer's metrics.** Artist sees only their own projects/tracks/bookings.

### 19.3 Skitza's own product analytics

**PostHog** (self-hosted or cloud free tier) — wires the 10-15 most important events:
- `producer.signup.completed`
- `producer.onboarding.step_completed` (per step)
- `producer.share_link.copied`
- `producer.quick_action.clicked` (per action)
- `artist.signup.from_link`
- `artist.first_booking.completed`
- `project.auto_created`
- `autopilot.toggle.enabled` (per toggle)
- `setup.tab.viewed` (per tab)
- `experimental.feature.used`

**No PII in events.** User IDs are hashed. PostHog's "people" feature disabled in favor of event-only analysis.

### 19.4 Magic-link view tracking (deferred)

When the trackable `/m/<token>` variant ships (Phase 2+), per-recipient analytics (opens, dwell, track replays) come with it.

---

## 20. Support & community

### 20.1 Channel

**Email (`support@skitza.app`) + in-app chat widget** (Intercom / Crisp / Plain). Chat widget converts 3× better than email-only.

### 20.2 Public changelog

`skitza.app/changelog` auto-updates on every deploy. Producer-facing trust signal ("we ship a lot"). Built via GitHub Actions post-merge. Also shown in-app as "What's new" dropdown.

### 20.3 Feature requests

**In-app "Request a feature" button** → email to product inbox → manual triage. No public board (Canny / Productlane) until volume justifies it.

### 20.4 Documentation

Help center at `help.skitza.app` (self-hosted or Gitbook). Search-first. Written in English only for v1.

### 20.5 Discord / community

Optional. Not a primary support channel. Consider opening a Discord around launch for early-adopter producers to connect.

---

## 21. Audio pipeline

### 21.1 Upload constraints

- **Max file size**: 100 MB per file
- **Supported formats**: WAV, FLAC, MP3, AAC (exactly 4)
- **Rejected formats**: M4A, OGG, AIFF, raw stems archives outside the zip-stems flow
- **Waveform generation**: `audiowaveform` + ffmpeg pipeline; peaks JSON cached on R2
- **Multipart uploads**: R2 presigned URLs for files > 20 MB; resumable via tus protocol shim

### 21.2 Stems

Uploaded as **a single zip file** on a track version. Presented as "Download stems" on the finished version. No per-file handling inside the zip.

### 21.3 Versions

Track versions stack under each track (Samply-style). Active version gets the hero waveform (320px desktop / 200px mobile). Inactive versions show 64px inline waveforms.

### 21.4 Comments

Timestamped per-version. Artist + producer only. Resolved-state synced across sessions via tRPC.

---

## 22. Monitoring, ops & deployment

### 22.1 Error tracking

**Sentry** (Next.js integration). Free tier covers early volume. PR comments on regressions are useful.

### 22.2 Uptime / status page

**BetterStack or Instatus** (free tier) → public `status.skitza.app`. Users bookmark it. Automatic pages to you (email or Slack) on outage.

### 22.2b On-call paging rule (Round 2 E5)

**Phone-page Gili only for p0**: site fully down, payments fully broken, data loss detected. Everything else lands in the Sentry dashboard and waits for Gili's next session. Rationale: Gili's sleep is the bottleneck resource in a solo-founder company. Don't burn it on 500 errors that affect one user.

Sentry alert rules to configure:
- Page on: 50%+ requests returning 5xx for >5min, OR any Stripe webhook failure, OR any database connection loss
- Silent: single-user 4xx/5xx, slow queries under the 1% threshold, deprecation warnings

### 22.3 CI branch protection

**Enforced on `main`**: `test + typecheck + lint` must all be green before merge. GitHub branch protection settings locked.

### 22.4 Deployment

- Vercel for the web app (Fluid Compute, not Edge — better compat)
- Neon for Postgres
- Cloudflare R2 for media
- Documenso on Fly.io for signatures
- Production deploy: squash-merge to `main` triggers Vercel deploy
- Preview deploy: every PR gets a branch-tip preview URL

### 22.5 Migrations

**Until `_journal.json` is fully rebuilt**: canonical workflow is `/skitza-migrate` (direct SQL via neon HTTP client, bypasses the broken drizzle-kit journal). See `CLAUDE.md` for details.

### 22.6 Vercel tier

Hobby tier limits:
- 1 cron per day minimum interval (sufficient for Autopilot daily-reminder behaviors)
- No custom concurrency scaling

**Upgrade to Pro when**:
- Sub-daily crons needed (unlikely; daily covers all Autopilot jobs)
- Concurrent user load demands more function capacity

---

## 23. Roadmap signals (when to revisit non-goals)

The things we're NOT building — and what would change the decision.

### 23.1 AI Copilot / LLM features

**Trigger to reconsider**: 5+ explicit user requests + validated willingness to pay the API cost (producer survey or pricing test). Until then: no API-key dependency.

### 23.2 Voice-first input / transcription

Same as AI: requires API. Revisit when AI Copilot revisit trigger fires.

### 23.3 Producer referral network

**Trigger**: producers organically ask "can I send overflow work to other Skitza producers?" Need critical mass first (50+ producers active).

### 23.4 Multi-engineer / team mode

**Trigger**: first user asks for team access (ideally a paying user). Studio tier is the natural home if we ever add it back.

### 23.5 Beat licensing

Different business model. Revisit only if a clear user pain emerges on top of existing services catalog.

### 23.6 Auto-generated social content (waveform videos, teaser clips)

Tracks are producer-internal. Artists distribute via DistroKid. Revisit only if producers ask for a "social post" export feature.

### 23.7 Custom domains

**Never.** Skitza subdomains only. Ops complexity (ACME, DNS) not worth the niche value.

---

## 24. Planned schema migrations

Schema changes required to deliver the locked-in PRD:

### 24.1 Model 2: one project, many bookings

**Migration**: flip `projects.bookingId` (1:1 FK) → add `bookings.projectId` (many-to-1 FK); drop `projects.bookingId`.

**Blast radius**:
- `booking.confirm` (auto-project logic) needs to associate to existing project if artist has an in-progress project for this service
- Sessions sub-tab renders a list, not a single booking
- ICS generation works per-booking as before

**Deferred**: can ship after v1 launch if Model 2 isn't immediately needed (single-session bookings work fine under the current 1:1 model; Model 2 only matters when a "production" service produces multiple scheduled sessions).

### 24.2 Pricing tiers (collapse to 2)

No schema change needed. `producers.tier` enum exists; we just use `Free` + `Pro` and retire `Studio` silently.

### 24.3 Product analytics (PostHog)

Schema-free — event ingestion only. Add `NEXT_PUBLIC_POSTHOG_KEY` env var + small wrapper hook.

### 24.4 Tauri Mobile

Entirely separate `apps/mobile/` workspace (or reuse `apps/desktop/` with mobile target flags). No web-app schema change.

---

## 25. Non-goals (hard constraints, still in force)

| Feature | Why not |
|---|---|
| AI Copilot / LLM calls | No API-key dependency — see §23.1 |
| Voice-first capture | Same |
| framer-motion or JS animation libs | CSS-only — zero bundle cost |
| Custom domains | Never — §23.7 |
| Native iOS/Android before Tauri Mobile | Path is Tauri Mobile first — §17.2 |
| Multi-engineer / team mode | Demand-driven — §23.4 |
| Beat licensing | Different business — §23.5 |
| Auto-generated social content | Tracks are internal — §23.6 |
| DAW integrations | Too fragmented — §18.5 |
| Webhooks out / Zapier | Deferred — §18.4 |

---

## 26. Open questions for future PRD revisions

After v2 lock, the remaining open items (intentionally not answered in this pass):

- **DMCA / copyright takedown flow**: how does a producer respond to a copyright claim on a portfolio track?
- **Data residency (EU)**: does EU artist data need to stay in EU? (Blocker for GDPR compliance in some jurisdictions.)
- **Accessibility certification**: WCAG 2.1 AA is the internal target, but no formal audit is planned for v1.
- **Affiliate program for producers referring new Skitza users** (not referral between producers — that's §23.3).
- **Branding for artists**: does the artist app expose "Powered by Skitza" to the artist, or is the artist experience fully Skitza-branded?
- **Promotional codes / coupons on producer services**: not addressed.

Tagged with `<!-- Q: -->` as they arise; revisit in future PRD pass.

---

## 27. Appendix: tech-stack commitments

See `CLAUDE.md` for exhaustive detail. Highlights:

- Next.js 15 App Router
- tRPC v11
- Drizzle ORM 0.36 + Neon Postgres
- Clerk v7 (auth)
- Stripe Connect Express
- Cloudflare R2 (media)
- Documenso (e-signatures)
- Tailwind v4 + CSS vars
- next-intl (cookie-driven, authenticated app only)
- Vitest (testing)
- wavesurfer.js v7 (audio)
- Tauri 2 (desktop + mobile)
- Sentry (error tracking)
- PostHog (product analytics)
- BetterStack or Instatus (uptime)

**No swaps without PRD update.**

---

## 28. GTM playbook (Round 2 addition — 2026-04-21)

Product strategy belongs in the PRD. This section captures the GTM/launch decisions so they're part of the normative spec, not scattered in plan docs.

### 28.1 The elevator pitch

> **"Everything a music producer needs to run their studio as a business, in one link."**

The "one link" is `skitza.app/join/<slug>`. It's the product's core magic and should anchor every piece of marketing copy.

### 28.2 Target audience — wedge-thin

**For**: solo music producers, making money from music as paid work, spanning production/mixing/mastering.

**NOT for**: bands, studios with multiple engineers, labels, hobbyists, non-music creators (no podcasters, no voiceover, no video editors).

Keep the wedge razor-thin. Expansion is earned, not planned.

### 28.3 Vision — 24 months out

Profitable lifestyle business. ~200 producers × $29/mo ≈ $5.8k MRR. Gili runs it solo. The product design reinforces this (solo focus, no team mode, no custom domains). Fundable-startup pivot is optional if traction dictates; bootstrap is the default path.

### 28.4 Geographic scope at launch

**Global English from Day 1.** Skitza is not Israel-first. Hebrew UI is deferred to Month 2+ only if beta producers explicitly ask.

### 28.5 Go-to-market channels (v1)

1. **Instagram DMs** — Gili personally reaches out to ~50 producers whose work he respects. First channel, highest signal.
2. **Content** — weekly cadence: 1 Instagram reel + 1 blog post + 1 YouTube walkthrough per month. All "how I use Skitza" / case-study framing.
3. **Referral loop** — two-prong:
   - Active: "Refer a producer, get 3 months free" (classic SaaS referral)
   - Passive: "Powered by Skitza" badge on free-tier producers' `/join/<slug>` pages
4. **Soft launch** — network first (Gili's IG), then Product Hunt one week later.

**No paid ads** until unit economics validate with the first paying cohort.

### 28.6 Beta cohort (launch validation)

**5 beta producers**, milestone-based beta (ends at first paid booking end-to-end with zero manual intervention). Cohort diversity target: 3 similar to Gili + 2 different genres/regions.

**Feedback surface**: weekly 30-min 1-on-1 calls + shared WhatsApp group + in-app support widget.

**Beta pricing** (see §7.1): "pay what you want" during beta, 6 months grandfather free after close, $29 Pro price thereafter.

### 28.7 Success metrics

- **Breakeven**: 100 paying producers (≈ $2,900 MRR, 5% fee on their volume = pure gross).
- **Launch-window deadline**: first revenue by July 2026 (runway-driven). If at that point MRR < $500, iterate/pivot; if MRR > $2k, continue bootstrap; if MRR > $5k, start seed-raise conversations.

### 28.8 Funding stance

**Bootstrap to $5k MRR.** Only then consider a small seed (~$250k) if and only if it unlocks meaningfully faster growth. Friends-and-family or grants not being pursued.

### 28.9 Positioning vs competitors

| Competitor | Their lane | How we're different |
|---|---|---|
| **Samply** | Audio review + collab | We add booking + payments + contracts; they stay audio-only |
| **HoneyBook / Dubsado** | Generic service-business CRM | We're audio-native (waveform, timestamped comments, stems) |
| **Studioflow / Booking-focused tools** | Studio scheduling | We combine scheduling with the artist-signup loop (`/join`) |
| **Splice / Soundtrap** | Collaboration tooling | We're about the business, not the production itself |

Skitza is the only tool that owns the entire solo producer's business surface in one place. That's the positioning.

---

*PRD v2 locked 2026-04-20. Round 2 GTM section added 2026-04-21. Next revision when a §26 question gets answered or a §23 trigger fires.*
