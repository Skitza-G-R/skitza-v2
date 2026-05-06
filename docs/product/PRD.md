# Skitza — Product Requirements Document

**Version:** 4.0  
**Date:** April 2026  
**Status:** Source of truth. All build decisions defer to this document.

---

## §1 — Vision

Skitza is the one app a solo music producer opens in the morning.

It replaces the Calendly + Samply + Notion + Stripe + WhatsApp stack with a single product. The producer's job is to make music with artists. Skitza's job is to handle everything else — scheduling, payments, file review, project tracking, portfolio, CRM — automatically where possible, one tap where not.

**Core product promise:**  
> "One permanent link in your Instagram bio. Artists click, listen, sign up, and book — with zero manual client entry on your end."

Everything downstream — project tracking, deliverables, payment — materialises automatically from that first booking. The producer configures once and runs on autopilot.

---

## §2 — Personas

### 2.1 Producer (primary)

Independent solo music producer. Makes a living from 5–20 active projects at a time. Works across multiple artists — mixing, mastering, production. Currently juggles 5+ apps. Lives on Instagram/TikTok for discovery.

**Job-to-be-done:** "Replace my admin toolchain so I can spend all my time making music."

### 2.2 Artist (secondary — "the client")

The producer's customer. Vocalist, rapper, band, label A&R, or indie artist looking for production services. Discovers producers via Instagram, TikTok, Spotify credits, word of mouth.

**Job-to-be-done:** "Work with this producer without needing a 12-message DM negotiation."

---

## §3 — Guiding Principles

- **Share-first, not create-first.** Producers share ONE link; everything else cascades automatically.
- **Autopilot over configuration.** Smart defaults + named toggle switches over rule builders.
- **One screen per job.** 6 producer pages, never more. Each page owns one clear job.
- **Progressive onboarding.** Artists browse a teaser without signup; sign up to unlock full access.
- **English default.** Only English in v1. next-intl is wired for future Hebrew/Arabic but only `en.json` is populated.
- **No AI dependency.** No LLM API keys required to run Skitza.
- **Skitza subdomains only.** No custom-domain feature. `/join/[slug]` is the permanent format.
- **Desktop-first for producers.** Producer dashboard is desktop-only in v1. Artist song page has a dedicated mobile UI.

---

## §4 — Producer Platform

The producer's authenticated dashboard. Six pages, each accessible from main navigation.

### Routes

| Page | Route |
|---|---|
| Overview | `/dashboard` |
| Clients & Projects | `/dashboard/clients-projects` |
| Music Library | `/dashboard/music` |
| Calendar | `/dashboard/calendar` |
| Storefront (Profile) | `/dashboard/profile` |
| Settings | `/dashboard/settings` |

---

### 4.1 — Overview `/dashboard`

The producer's daily home screen. A glanceable dashboard that surfaces the most actionable information the moment you land. Every element is a shortcut into a deeper page — no editing or mutations happen here. The page auto-loads fresh data on every visit; no manual refresh or date filter.

**Layout: 4 independent blocks of equal hierarchy.**

#### Block 1 — 3 Most Urgent Projects

A panel showing exactly three projects ranked by urgency, determined automatically by a combination of deadline proximity, overdue payment status, or stalled project state.

What it shows per project: project name, client name, current status, urgency signal.

- Clicking a project card → navigates into that project's room inside Clients/Projects.
- Read-only at overview level — no editing here.

#### Block 2 — Recent Music Uploads

A feed of the most recently uploaded audio files across all projects.

What it shows: track name, project it belongs to, upload timestamp, mini inline player or waveform indicator.

- Clicking a track → navigates to that song's detail view inside the Music Library.
- Clicking the project name → navigates to that project room.

#### Block 3 — Money / KPI Block

A financial summary widget — a status snapshot, not a full ledger.

Three data points:
- How much the producer has earned (total revenue to date or current period).
- How much is owed to them (outstanding balances across all clients).
- Who is not meeting their payment deadline (overdue clients flagged by name).

- Clicking an overdue item or client name → navigates to Clients page filtered to that client.

#### Block 4 — The Link

The producer's shareable booking and onboarding URL. Displayed with a copy button directly on the dashboard.

- Copy button → copies the link to clipboard.
- Optional share action (WhatsApp, email, direct copy).

> The link is the producer's primary acquisition tool. It needs to be instantly accessible from the home screen so it can be dropped into a conversation without navigating elsewhere.

---

### 4.2 — Clients & Projects `/dashboard/clients-projects`

The producer's core relationship and project management page. One combined page with a tab navigation at the top switching between two views: Clients and Projects. Also contains the full artist onboarding flow and bulk CSV import.

**Page entry point — Main table:**  
Visible before selecting a tab. Shows clients and projects combined. Columns: contact details, number of projects, active/inactive status, balance, total money to date.

#### Tab 1 — Clients

Client list displayed as an accordion — client names expand to show their projects underneath.

Each client row shows: contact details (name, phone, email), number of projects, active/inactive status, balance.

**Drilling into a client exposes three sections:**

- **Edit Contact Details** — update name, phone, email, and other contact fields.
- **Client-Project Junction** — which projects are associated with this client; ability to link or unlink.
- **Project Details** — full project detail from the client's perspective.

#### Tab 2 — Projects

Full project list. Each project drills into a project room with four branches.

**Project Room — Dashboard branch:**
- Real-time status widget showing project completion as a percentage.
- Progress bar and current status label.

**Project Room — Songs branch:**

Full track management for this project. Per-track features:
- File upload.
- Edit/delete track details.
- Timestamped comments — SoundCloud/Samply-style, same system as Music Library.
- Version updates — upload a new version; system auto-increments the version number.
- Google Drive link field for distribution channels.
- Project folder setup.

The song page within the project room uses the same desktop/mobile dual design as the Music Library song page.

**Project Room — Payments & Agreements branch:**
- Payment tracking: what has been paid, what is outstanding, payment schedule.
- Inline agreement tied to this project (agreedAt timestamp, checkbox-style, not PDF).

**Project Room — Status Widget branch:**
- Real-time percentage progress of the project.
- Status updates flow up to the Overview page Block 1.

#### Artist Onboarding Flows

Two methods for adding an artist, both accessible from this page:

**Manual addition (existing artist):**
- Producer manually creates the artist record.
- Selects which projects or products the artist gets access to.
- A link is generated and sent to the artist for account connection.

**Via link (new artist):**
- Producer sends the join link → artist goes through onboarding → connects to platform.
- During onboarding, the producer's store and sessions are shown to the artist.

**Bulk add:**
- CSV import for adding many clients at once. Errors flagged before import is finalised.

> Product clarifications: (1) Existing clients/projects can be imported via CSV. (2) A producer can manually add any project or client from within the relevant page. (3) When a client pays for an intro session and wants to open a new project, every project has a share link — the client signs up and pays through it. (4) An intro session is its own standalone project.

---

### 4.3 — Music Library `/dashboard/music`

The producer's central audio management hub. Organises all uploaded tracks across all projects in one place, with tools to upload, version, play, and collect feedback. Modelled after Samply's library flow.

**Three-level structure:** Library entry point → Project-Focused Library → Song Page.

#### Level 1 — Library Entry Point

The landing screen. Shows all projects the producer has uploaded music to.

Display options: grid view (cards/tiles) or table view (rows).  
Filter controls: upload time, artist name.

- Toggling grid/table → re-renders in selected layout, no navigation.
- Clicking a project → drills into the Project-Focused Library for that project.
- Clicking "+ Add New Song" → opens the Add Song workflow.

#### Level 2 — Project-Focused Library

A drill-down view for a single project, showing all its tracks.

What it shows per song: name, duration, version (v1/v2/v3), last upload date, listen count.

Additional controls: download button, favorites button.

- Clicking a song row → opens the Song Page for that track.
- Download button → triggers file download.
- Favorites button → toggles favorite state, persists on the track record.

#### Level 3 — Song Page

**Desktop version:**
- Waveform display — full visual representation of the audio.
- Prominent comment panel — SoundCloud/Samply-style timestamp commenting. Clicking a waveform point opens an inline comment input tied to that exact timestamp.
- Floating bottom player — opens when the song plays, stays visible while navigating elsewhere.
- Version switcher — easy toggle between v1/v2/v3 for A/B mix comparison.

**Mobile version:**
- Spotify-style player UI — album art, play/pause/next controls, progress bar.
- Prominent comment button — tapping pauses music at current timestamp, opens comment input, resumes on submit.
- Minimisable player — collapses to a persistent floating player at the bottom of the screen.

**Song Page triggers:**
- Playing → activates floating bottom player.
- Clicking waveform timestamp (desktop) → opens inline comment input.
- Tapping comment button (mobile) → pauses, opens input, resumes on submit.
- Submitting a comment → saves timestamp comment, appears in the thread.
- Switching version → reloads with the selected version's audio.
- Minimising (mobile) → floating player persists.

#### Feature — Add New Song

- Click "+" → opens add-song flow.
- Assign to a project → producer selects which project the track belongs to.
- Versioning assigned automatically (v1/v2/v3) based on last modified date — system determines version number, no manual input needed.
- Completing upload → new track appears in Project-Focused Library with auto-assigned version.

#### Feature — Custom Playlists

Create personal playlists from tracks across projects. Includes per-track listen tracking. Lets the producer curate listening sessions (e.g. "tracks ready for review", "mixes in progress") without affecting project structure.

#### Cross-Screen Comment Behaviour

> Comments made on a song surface in three places: the Song Page (primary), the Music Library screen at the project level, and the Project screen inside Clients/Projects. A comment left by an artist on mobile appears for the producer in any context they are viewing that track.

---

### 4.4 — Calendar `/dashboard/calendar`

The producer's scheduling control centre. Two branches: Meetings (all session-facing interactions) and Availability (all configuration settings).

#### Branch 1 — Meetings

**Upcoming Sessions:**  
All upcoming booked sessions sorted by date. Each entry shows session date/time, the artist or client, and which project or product it's connected to.
- Clicking a session → opens session detail view for viewing or editing.

**Intro Session Approvals:**  
A dedicated queue for pending intro session requests. When an artist books through the producer's link, the request lands here.
- Approve → session confirmed, automatic email invitation sent to the artist.
- Reject → session request declined.

**Edit / Modify Session Details:**  
Edit any booked session's details — date, time, participants, linked project.

> Two-way sync with the phone calendar — changes made here reflect in the producer's phone calendar and vice versa. *(GCal OAuth is a placeholder in v1 — UI shows "Coming soon". Two-way sync is fully described here as the target behaviour for when it ships.)*

- Saving edits → updates the record, syncs to phone calendar (when connected).

**Create Session:**  
Manually create a new session. Three required elements:
- Must connect to an existing project or product — sessions cannot float freely.
- Add external people — invite participants who may not be on the platform.
- Automatic email invitation sent — all participants receive an invite on session creation.
- Completing → session appears in Upcoming Sessions, email invites fire, syncs to phone calendar (when connected).

#### Branch 2 — Availability Settings

**Active Days:**  
Which days of the week the producer is available. Toggle per day. Saving → booking system only shows these days to artists.

**Activity Time Windows:**  
The hours within active days during which sessions can be booked.

> Time windows can be capped — the producer sets a maximum number of sessions per day. Validation logic enforces this cap even if time slots technically exist.

**Specific Hours for Specific Days:**  
Per-day overrides for the general time windows. These take precedence when the booking system calculates availability.

**Automatic Reminders:**  
Automated messages sent before sessions. Includes both a reminder and an arrival confirmation — an active check asking the participant to confirm attendance, not just a passive reminder.

**Automatic Approval:**  
A toggle. When on → all new session requests skip the Approvals queue and go directly to Upcoming Sessions. When off → all requests require manual approval first.

**Cancellation Policy:**  
How far in advance a session can be cancelled, defined in hours. The system enforces this window and surfaces the policy to artists during booking.

---

### 4.5 — Storefront (Profile) `/dashboard/profile`

The producer's public-facing commercial surface and identity hub. This is the page clients see when they receive the producer's link — they listen to the portfolio, see prices, and convert.

> End-user flow: Client receives link → listens to portfolio → sees prices → selects a product → signs in → books a session → pays → lands on the artist platform → goes through short onboarding.

**Two branches: Store and Portfolio.**

#### Branch 1 — Store

**Add Products — two creation paths:**

*Path A — Manual (Custom):*  
Producer fills in everything from scratch: product name, price, mix/master toggle, session duration, number of sessions, payment terms, contract.

*Path B — Template-Based:*  
Producer picks a template and updates: price, VAT, mix/master, session duration, number of sessions, payment terms, contract.

> Everything that can be a toggle should be a toggle — the UI favours toggles over free-text fields wherever possible.

Both paths end at a **Preview Screen**. Approving → product goes live. Editing → returns to creation form.

**Delete / Update Products:**  
Each product has a pencil icon for inline editing and a visibility toggle (show/hide) to remove from the public storefront without deleting from the system.
- Saving edits → changes immediately live on public storefront.
- Deleting → removes the product entirely.

**Store Preview:**  
A full read-only preview of the storefront exactly as a client sees it. No edits happen here — a sanity-check view before sharing the link.

#### Branch 2 — Portfolio

- **Social & Streaming Links:** Spotify playlists, SoundCloud, Instagram, and other platforms. Adding/editing → immediately updates the public storefront.
- **Profile Image:** Upload, crop, replace. Uploading → replaces current image on the public storefront immediately.
- **Songs (imported from Music Library):** Producer selects which tracks to feature publicly as a listening showcase. Removing a song from the portfolio → disappears from storefront, remains in Music Library untouched.

---

### 4.6 — Settings `/dashboard/settings`

The producer's account management and integrations hub. Platform-level settings only — no commercial content, no portfolio, no services, no availability. Intentionally minimal.

**Two branches: Profile and Integrations.**

#### Branch 1 — Profile

- **Name:** Display name used throughout the dashboard. Saving → updates across the platform.
- **Email:** Login email. Changing requires verification of the new address before login credentials update.
- **Currency:** Default currency for all monetary values. Does not retroactively reformat past records.
- **Image:** Account avatar shown inside the platform interface. Distinct from the storefront profile image managed on the Storefront page.
- **Delete Profile:** Permanent account deletion. Requires a confirmation step. On confirmation — all producer data, products, projects, clients, and sessions are permanently deleted and cannot be recovered.

#### Branch 2 — Integrations

**Google Calendar:**  
Target: two-way sync between Skitza sessions and the producer's Google Calendar.  
**v1 status: UI placeholder — "Connect Google Calendar (coming soon)" button. OAuth not yet implemented.**

**Payment Clearing System:**  
Target: connection to a payment processor for client payments through the platform. Includes a clearing company and Green Invoice for Israeli tax compliance.  
**v1 status: UI placeholder — "Connect payment provider (coming soon)" button. Provider TBD — to be discussed with Grow. Exact integration flow is TBD.**

**CSV Import / Bulk Client Add:**  
Tool for importing existing clients in bulk from a spreadsheet.
- Uploading a valid CSV → creates client records in Clients/Projects for each row.
- Errors or malformed rows are flagged for review before import is finalised.

---

## §5 — Producer Onboarding

An 8-step linear pipeline from account creation through to the producer platform. Each step is a distinct screen. The producer cannot access the platform until onboarding is complete, with the exception of the payment connection step which can be skipped.

| Step | Screen & Content |
|---|---|
| 1 | **Sign Up** — Email and password. Account creation entry point. |
| 2 | **Personal Details** — Studio name, full name, and additional personal information. |
| 3 | **Services** — Multi-select checkbox UI. Producer taps all service types that apply (Producer, Mixing Engineer, Recording Artist, Mastering Engineer, etc.). Selections determine which templates are shown in Step 4. |
| 4 | **Service Templates** — Based on Step 3 selections, matching pre-built templates are presented for editing. Producer adjusts price, VAT, session duration, number of sessions, payment terms. Templates adapt to the producer's service type. |
| 5 | **Working Hours + Google Calendar** — Producer sets weekly availability (active days and hours). Includes GCal connection prompt. *(GCal is a placeholder in v1 — prompt explains it's coming soon.)* |
| 6 | **Payment Connection (skippable)** — Producer connects their payment processing system. Can be skipped and configured later in Settings → Integrations. *(Placeholder in v1 — UI only.)* |
| 7 | **Portfolio** — Producer sets up their public portfolio: social/streaming links, featured songs from the music library. |
| 8 | **Onboarding Complete** — Summary/welcome confirmation. Completing → drops the producer into the Producer Platform dashboard. |

### Sign In Flow — Returning Users

- Step 1: Sign In — Email and password.
- Step 2: Artist or Producer? — Role routing screen. Selecting Producer → Producer Platform. Selecting Artist → Artist Platform.

---

## §6 — Artist Platform

The platform artists access after onboarding via a producer's link. Five sections.

### 6.1 — Dashboard

The artist's home screen. Three widgets:

- **Upcoming Sessions:** List of next booked sessions — date, time, producer name, project. Clicking a session → opens session detail.
- **Recently Uploaded Files:** Feed of most recently uploaded tracks across the artist's projects. Clicking a file → opens that track in the player.
- **Balances:** Current account balance — what has been paid, what is outstanding, any credits held.

### 6.2 — Store

The full end-to-end purchase flow. Linear sequence from browsing to confirmation:

Producer Catalog → Product Description → Agreement → Book Session → Payment → Confirmation Screen.

- Payment gates download access in Music — downloads are blocked until payment is confirmed.
- On payment success → session appears in Dashboard upcoming sessions. Artist gains access to the relevant project in Music.

### 6.3 — Book Sessions

Standalone session booking — used when the artist books an additional session independently of a store purchase.

Flow: Which producer? → Which project? → Session Booking Screen (days then hours) → Calendar Sync.

> Two-way calendar sync — only relevant, available days are shown. Days blocked on the producer's side do not appear as options.

Completing booking → session appears in Dashboard upcoming sessions, syncs to artist's calendar, producer receives notification.

### 6.4 — Music

The artist's music access hub. Three levels of depth:

- **Producer-Focused Library:** View filtered to a specific producer's uploads across all shared projects.
- **All Music Library:** Full music library across all producers and projects the artist is part of.
- **Project Screen:** All tracks for a specific project — song list, versions, upload dates.
- **Player with Timestamped Comments:** Same design as the producer platform — desktop waveform with timestamp comments, mobile Spotify-style player. Comments pause music at the timestamp on mobile, resume on submit.

> Download button is blocked until payment has been received. The artist can listen freely but cannot download until the producer confirms payment.

### 6.5 — Settings

**Profile:**  
Name and Photo — display name and profile picture used within the platform.

**Integrations:**
- **Google Calendar:** Two-way sync so session bookings appear in the artist's personal calendar. *(Placeholder in v1.)*
- **Payment method:** For store purchases and session bookings. *(Placeholder in v1 — provider TBD.)*

---

## §7 — Landing Page `/`

The marketing landing at `/` is the front door for cold visitors. Signed-in producers redirect to `/dashboard`. Signed-in artists redirect to `/artist`.

### Aesthetic baseline (locked)

- Typography: Outfit (body) + Syne (headings) via Google Fonts.
- Palette: warm off-white `#F2EDE6` (light sections) ↔ deep brown-black `#111009` (dark sections) with amber `#D4960A` + copper `#B06830` accents.
- Tactile SVG noise overlay at 0.02 opacity (full-viewport fixed layer).
- Custom CSS-only animations: scroll-reveal via IntersectionObserver, word-by-word hero fade, hover lifts. No framer-motion, no animation libraries.
- The landing has its **own scoped CSS tokens** — does NOT use the authenticated app's design system. The two surfaces have intentionally different visual identities. This separation is locked.

### Section order (17 sections, top to bottom)

| # | Section |
|---|---|
| 1 | LandingNav — Features / How It Works / Pricing + Sign In (text link) + Sign Up (amber button) |
| 2 | Hero — "Stop chasing payments. Just make music." + dual CTA + word-by-word fade-in |
| 3 | TrustBar — social-proof logos / press strip |
| 4 | PainGrid — what's broken today (Calendly + Samply + Notion + DocuSign + Stripe + WhatsApp) |
| 5 | SolutionFlow — how Skitza unifies it |
| 6 | FeaturesTabs — 7 tabs: Storefront & Booking / Payments / Files & Feedback / Client History / Follow-up / Lead Management / Contracts & Protection |
| 7 | Compare — head-to-head against the unbundled stack |
| 8 | HowItWorks — 3-step user journey |
| 9 | Consolidation — "everything in one place" |
| 10 | Security — privacy, storage (R2), auth (Clerk) |
| 11 | Testimonials |
| 12 | Pricing — 2 tiers, 14-day free trial, no credit card required |
| 13 | FAQ — accordion |
| 14 | Founder — personal pitch |
| 15 | Download — PWA mobile install prompt |
| 16 | FinalCTA — last conversion surface before the footer |
| 17 | SiteFooter |

### CTA decisions

- Primary CTA copy: "Sign up now"
- Primary destination: `/sign-up` (Clerk) → on success, auto-redirects to `/dashboard/onboarding`
- Secondary CTA: "Sign in" → `/sign-in` (text link in nav only)
- No lead-capture modal. No email gate, no early-access form, no waitlist.

---

## §8 — Booking Flow

- **Timezone:** Artist picks their timezone during booking; availability displayed in both producer's and artist's timezones.
- **Single-day only:** Individual bookings are single-day. Multi-day engagements happen as multiple bookings under one project.
- **Reschedule:** Either party can initiate. Artist request → producer approves (or auto-approves if Automatic Approval is on). Producer can reschedule unilaterally with a notice email.
- **Buffer:** Producer-configurable in Availability settings (default 15 min between sessions).
- **Multi-participant:** Single booker, but can add session participants — name + email. Participants receive the calendar invite (.ics) but don't get Skitza accounts.
- **Intro sessions:** Treated as standalone projects. When an artist books an intro session, a new project is created for it.

### Artist booking experience

1. Picks service → sees availability filtered by producer's Calendar settings.
2. Picks slot → confirms terms inline (cancellation policy surfaced here).
3. Pays deposit *(placeholder in v1 — "Reserve session, payment coming soon" button)*.
4. Project auto-created, artist-accessible immediately in the artist platform.

### Payment placeholder (v1)

In v1, payment is not integrated. The booking flow creates a project with `invoice.status = 'pending'`. The producer manually marks invoices as paid from the Payments & Agreements branch of the project room. The payment provider will be connected in a future sprint after the provider decision is made.

---

## §9 — Project Model

**One project, many bookings.**

- Single-session services: 1 booking → 1 project.
- Production services (multi-session): 1 project, many bookings. Artist books once → project created. Each subsequent session is a new booking rolled under the same project.

The Songs branch in the Project Room shows all tracks associated with the project. The Payments & Agreements branch tracks all financial activity across bookings.

---

## §10 — Services Catalog

Services are created and managed via the Storefront page (`/dashboard/profile` → Store branch). The onboarding wizard (§5 Steps 3–4) bootstraps the first service using the same product-creation components.

### Structure

3 fixed categories + 1 custom type:
- Production
- Mixing & Mastering
- Consulting
- Custom / one-time session — free-form, producer-defined title, no category

### Service template quickstart (5 built-in)

| Template | Default details |
|---|---|
| 3-hour mixing session | $150 · 180 min · single-session |
| Album production package | $4,500 · multi-session · 50/50 split |
| Weekend intensive | $600 · 480 min · flat |
| Remote feedback round | $75 · 60 min · async |
| Mastering pass | $200 · 90 min · single-session |

### Visibility

Each product has a Public / Unlisted flag. Unlisted products are only accessible via direct URL — useful for VIP quotes.

---

## §11 — Notifications & Email

### Artist emails — default ON

- Booking confirmed
- Final payment due
- Track version uploaded
- Producer replied to your comment

### Producer emails — default ON

- New booking request
- Payment received
- New comment from artist
- Booking cancelled or rescheduled

### Email branding

"Producer X via Skitza" — producer's name/logo in the email header, subtle Skitza footer.

---

## §12 — Audio Pipeline

- **Max file size:** 100 MB per file.
- **Supported formats:** WAV, FLAC, MP3, AAC.
- **Waveform generation:** audiowaveform + ffmpeg pipeline; peaks JSON cached on R2.
- **Multipart uploads:** R2 presigned URLs for files > 20 MB; resumable via tus protocol shim.
- **Stems:** Uploaded as a single zip file, presented as "Download stems" on the finished version.
- **Track versions:** Stack under each track (Samply-style). Active version gets the hero waveform. Inactive versions show 64px inline waveforms.
- **Auto-versioning:** Version number (v1/v2/v3) is assigned automatically based on last modified date — no manual input needed.
- **Comments:** Timestamped per-version. Artist + producer only. Resolved-state synced across sessions via tRPC.

---

## §13 — Internationalisation

- **v1 scope:** English only. `next-intl` is wired and `en.json` is populated. `he.json` and `ar.json` exist as stubs for future use.
- **Default locale:** English for everyone. No IP-based auto-detection.
- **Hebrew / Arabic:** Deferred. Will be added when beta producers in those markets explicitly request it.
- **Landing page:** English-only, always. No translation on public-facing routes.

---

## §14 — Tech Stack

Locked. No swaps without a PRD update.

| Layer | Technology |
|---|---|
| Framework | Next.js 15 App Router |
| API | tRPC v11 |
| ORM + DB | Drizzle ORM + Neon Postgres |
| Auth | Clerk v7 |
| Payments | Stripe Connect Express *(wired, UI placeholder in v1)* |
| Media storage | Cloudflare R2 |
| Styling | Tailwind v4 + CSS vars + shadcn/ui |
| i18n | next-intl (English only in v1) |
| Testing | Vitest |
| Audio | wavesurfer.js v7 |
| Error tracking | Sentry |
| Product analytics | PostHog |
| Email | Resend + React Email |

**Removed from stack:**
- Tauri desktop app — deleted in v3-clean D1+D2. Desktop app is not part of the product.
- Documenso — deleted in v3-clean D5+D6. Contracts replaced by inline checkbox agreement (agreedAt timestamp).

---

## §15 — Non-Goals

Hard constraints. These are not deferred — they are explicitly out of scope.

| Feature | Why not |
|---|---|
| AI Copilot / LLM calls | No API-key dependency at launch |
| Custom domains | Skitza subdomains only — `/join/[slug]` is permanent format |
| framer-motion or JS animation libraries | CSS-only — zero bundle cost |
| Native iOS/Android app | Not in scope — web-only for v1 |
| Multi-engineer / team mode | Revisit when first paying user asks for team access |
| Beat licensing | Different business model entirely |
| DAW integrations (Ableton, Logic, Pro Tools) | Too fragmented — not Skitza's moat |
| Webhooks out / Zapier / n8n | Deferred — email covers automation needs at launch |
| Magic links (per-recipient trackable share links) | Deleted in v3-clean D7 — replaced by `/join/[slug]` |
| PDF contract generation and signing | Deleted in v3-clean D5+D6 — replaced by inline checkbox agreement |
| Lead-capture modal / email gate / waitlist | Friction kills conversion for an unknown brand |

---

*Skitza PRD v4.0 · April 2026 · Source of truth for all build decisions*
