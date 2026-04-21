# 360° PRD Socratic Session — Complete Q&A Log

> **What this is:** the complete Q&A journey that produced PRD v2. Every question I asked, every answer the user gave, and what it means. Mirrors the memory file at `~/.claude/projects/-Users-giliasraf-Skitza-16-4/memory/project_360_prd_answers.md` so this reasoning trace is in git and survives any memory reset.
>
> **When to read:** when you need to understand *why* a PRD section says what it says. The PRD captures the conclusions; this file captures the reasoning.
>
> **Source date:** 2026-04-20 Socratic session.
>
> **Status:** Canonical. If a new product decision is made, add a new section at the bottom rather than editing old entries.

---

## Round 1 — /join flow core (Q1-Q8)

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| Q1 | URL shape | **C** | `skitza.app/join/<slug>` — signals "join studio" |
| Q2 | First-visit view | **C** | Hybrid: 2-3 tracks visible + strong signup CTA |
| Q3 | Post-signup landing | **B** | Welcome splash → Home with producer attached |
| Q4 | Pre-signup music access | **B** | 2-3 sample tracks, rest gated |
| Q5 | Existing-account behavior | **B** | Confirm modal ("Add Producer X's studio?") |
| Q6 | Trackable magic-link variant | **B** | Defer — permanent link only for launch |
| Q7 | Custom domain | **C** | **Skitza subdomains only — no custom domains EVER** (flipped from my B=Paid-tier recommendation) |
| Q8 | Pricing tiers | **ok** | Free $0 / Pro $29 / Studio $79 — initially accepted, later simplified to Free + Pro only (see N1 follow-up) |

## Batch A — Producer activation & onboarding

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| A1 | Stripe Connect required? | **B** | Share + portfolio work without Stripe; Booking/Services blocked until Stripe linked |
| A2 | Minimum viable profile | **B** | Slug + display name + 1 portfolio track |
| A3 | Onboarding wizard | **C** | **5-step wizard** (flipped from my B=3-step): Profile → Portfolio → Services → Availability → Stripe |
| A4 | Customizable signup splash | **B** | Short customizable tagline + 1 CTA copy field; everything else templated |
| A5 | Multiple slugs/brands | **A** | One slug per account (solo-producer focus) |

## Batch B — Services / catalog

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| B1 | Service structure | **B + custom option** | 3 fixed categories (Production / Mixing & Mastering / Consulting) PLUS a free-form "one-time session (custom time)" option |
| B2 | Service variants/tiers | **B as option, A default** | Single tier is the default; producer can opt in to up to 3 price tiers per service |
| B3 | Deposit policy | **B** | Producer sets default (30% suggested); per-service override allowed |
| B4 | Service visibility | **B** | Each service has a "Public / Unlisted" flag |

## Batch C — Booking flow

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| C1 | Timezone handling | **B** | Artist picks timezone during booking; availability displayed in both |
| C2 | Multi-day bookings | *(clarified via Flag 1)* | "production = multi-session" → resolved via Model 2 (see D1) |
| C3 | Reschedule | **C** | Both — artist can request, producer approves (auto-approves if Autopilot on) |
| C4 | Buffer time | **B** | Producer-configurable (default 15 min) |
| C5 | Band sessions | **A** | One booker + additional session participants (name+email, calendar invite only) |

## Batch D — Project Room & files

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| D1 | Multi-project-per-client | *(clarified via Flag 1)* | **Model 2: one project, many bookings** — production = one project with multiple bookings rolled under it. Requires schema flip: `project.bookingId` → `booking.projectId` (1:many FK) |
| D2 | File retention | **B + notice** | Forever for signed-in artists; 90-day retention for guest (pre-signup) comments/uploads, WITH visible notice to artist |
| D3 | Who can comment | **A** | Only authenticated artist + producer (no anonymous / public comments) — flipped from my B=opt-in public |
| D4 | Download final tracks | **B** | Auto-release on Money = Paid status |

## Batch E — Payments, invoicing, refunds

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| E1 | Offline payments | **B** | "Mark as paid offline" action on invoice |
| E2 | Partial refunds | **A** | Producer can refund any % via a button → fires Stripe refund |
| E3 | Payment plan change | **A** | Producer can propose new plan mid-project; artist accepts → old charges kept, new schedule takes over |
| E4 | Multi-currency | **B** | Producer sets default; per-service/invoice override allowed |
| E5 | Late fees | **B** | Autopilot reminders only; no automated late fees in v1 |

## Batch F — Notifications & email

**F1 — Artist email triggers (default ON):**
- ✅ Booking confirmed
- ✅ Contract ready to sign
- ✅ Final payment due
- ✅ Track version uploaded
- ✅ Producer replied to your comment
- ❌ Session reminder 24h before
- ❌ Testimonial request after project complete (only if Autopilot toggle on)
- ❌ Monthly recap

**F2 — Producer email triggers (default ON):**
- ✅ New booking request
- ✅ Payment received
- ✅ New comment from artist
- ✅ Contract signed
- ❌ Daily digest
- ✅ Booking cancelled or rescheduled
- ❌ Weekly revenue summary

**F3 — Email branding: B** — "Producer X via Skitza" — producer's name/logo in header, Skitza subtle footer

## Batch G — Artist experience

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| G1 | In-app messaging | **B** | No messaging UI — track comments + email are the only comms |
| G2 | Cross-studio notifications | **A** | Bell shows notifications from ALL studios, grouped by studio |
| G3 | Artist profile fields | **B** | Email + display name + profile photo (no bio/social handles) |
| G4 | Artist history view | **B** | "My history" view lists every project across every attached studio |

## Batch H — Legal & compliance

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| H1 | ToS/Privacy Policy | **B** | Skitza provides standard ToS/Privacy — one for all producers; revised annually |
| H2 | GDPR delete | **B** | Self-serve button in Setup → Account; 30-day grace period then hard delete |
| H3 | COPPA / minors | **A** | Age-gate on signup: 13+ only (refuse under-13 signup) |
| H4 | E-signature scope | **B** | US + EU (E-SIGN + eIDAS Simple Electronic Signature); "legally binding where enforceable" elsewhere |
| H5 | Tax reporting | **A** | Stripe Connect Express handles 1099-K automatically |

## Batch I — Mobile & PWA

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| I1 | Native mobile | **C** (via follow-up) | **Tauri Mobile in parallel with v1** — reuses ~70% of web codebase to ship native iOS/Android (upgraded from my B=Phase 3 because user really wants a native app) |
| I2 | PWA installable | **A** | Ship manifest.json + icons — both producers and artists can "Add to Home Screen" |
| I3 | Push notifications | **B** | Email-only for v1; PWA push Phase 2 |
| I4 | Offline mode (artists) | **A** | **Offline mode ON** — service worker caches recently-played tracks (flipped from my B=no offline) |

## Batch J — Integrations

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| J1 | Google Calendar sync | **A** | **Ship now** — wire real OAuth this quarter (flipped from my B=defer) |
| J2 | iCal / .ics | **A** (via follow-up) | Every booking email includes .ics attachment |
| J3 | Zoom / Meet | **B** | Producer pastes their own video link into service config; Skitza includes it in booking emails |
| J4 | Zapier / webhooks | **B** | Defer — revisit after launch |
| J5 | DAW integrations | **B** | None — out of scope forever |

## Batch K — Data & analytics

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| K1 | Visitor analytics for producer | **B** | Aggregate only — total visits last 30 days, top-played tracks, conversion rate. Shown as a mini "Last 30 days" card on Today |
| K2 | Magic-link view tracking | *(deferred with Q6)* | Ship when trackable magic-link ships (Phase 2+) |
| K3 | Artist sees producer metrics | **A** | No — privacy-first; artist sees only their own projects |
| K4 | Product analytics | **A** (via follow-up) | **Install PostHog** (free tier, privacy-respecting) — event tracking for funnels + retention |

## Batch L — Roadmap signals (non-goals)

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| L1 | AI Copilot | **B** | Revisit when 5+ producers explicitly ask for it AND willingness to pay API cost is validated |
| L2 | Producer referral network | **B** | Build when producers organically ask "can I send overflow to other Skitza producers?" |
| L3 | Multi-engineer team mode | **A** | First paying Studio-tier producer asks for it |

## Batch M — Support & community

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| M1 | Support channel | **B** | Email + in-app chat widget (Intercom / Crisp / Plain) |
| M2 | Public changelog | **A** (via follow-up) | **`skitza.app/changelog`** auto-generated from PR titles; shown in-app as "What's new" |
| M3 | Feature-request channel | **B** | In-app "Request a feature" button → email → manual triage |

## Batch N — Pricing tier details

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| N1 | Studio tier differentiator | **A** (via follow-up) | **2 tiers only: Free + Pro ($29)** — skip Studio for launch. Add it if Pro users start asking |
| N2 | Free tier watermark | **B** | Subtle footer + small "Powered by Skitza" badge next to portfolio tracks |
| N3 | Free tier hard cap | **B (5 tracks)** | 3 active projects + **5 tracks** (tightened from my 20) + Autopilot locked |
| N4 | Pro tier platform fee | **C** | **5% platform fee** (lower than my 10% recommendation — more producer-friendly) + remove branding + Autopilot + unlimited |

## Batch O — Audio pipeline

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| O1 | Max file size | **100 MB** | Tightened from my 500MB — keeps R2 costs down, encourages MP3/AAC over raw WAV |
| O2 | Supported formats | **A** | WAV, FLAC, MP3, AAC — 4 formats only |
| O3 | Stems | **C** | **Zip-file download** for stems (flipped from my B=per-version label convention) — cleaner for the artist |

## Batch P — Monitoring & ops

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| P1 | Error tracking | **A** (with uncertainty) | Sentry — strong Next.js integration, PR comments on regressions |
| P2 | Uptime / status page | **B** (via follow-up) | BetterStack or Instatus free tier → public `status.skitza.app` |
| P3 | CI gates | **A** (via follow-up) | GitHub branch protection — test + typecheck + lint must be green before merge to main |

---

## Schema migration implications

User's answer to D1 (Model 2) requires a database migration:
- Flip `project.bookingId` (1:1 FK to bookings) → `booking.projectId` (N:1 FK to projects)
- Existing auto-project-on-first-booking behavior preserved — first booking creates the project row; subsequent bookings rolled under the same project
- Artist sees their "album production" as ONE project with multiple sessions, not 10 separate projects

## User's pattern — for future trust calibration

The user consistently overrode my recommendations **toward** simpler / cheaper / tighter / more privacy-respecting options. Specific overrides:

| Q | User chose | I recommended | Direction |
|---|---|---|---|
| Q7 | C (no custom domains ever) | B (paid tier) | Simpler |
| A3 | C (5-step wizard) | B (3-step) | More thorough first-run |
| D3 | A (auth-only comments) | B (public opt-in) | More privacy |
| I1 | C (Tauri Mobile in parallel) | B (Phase 3) | Faster to native |
| I4 | A (offline mode ON) | B (no offline) | Better artist UX |
| J1 | A (Google Calendar ships now) | B (defer) | More effort now, more value |
| N3 | 5 tracks free cap | 20 tracks | Tighter |
| N4 | 5% Pro fee | 10% fee | More producer-friendly |
| O1 | 100 MB upload cap | 500 MB | Cheaper |
| O3 | Zip-file stems | Per-version labels | Cleaner artist UX |

**Takeaway**: when options are close, bias toward simpler / cheaper / tighter / more-privacy-respecting. User adds complexity when they want it, not the reverse.

---

## How to apply this file

1. This is the **canonical reasoning trace** for PRD v2. Every locked decision traces back to a row above.
2. If you're implementing a feature and unsure about a design choice, check here first.
3. If a new decision is made after 2026-04-20, add it as a new section at the bottom with date + context.
4. **Never edit historical entries** — add revisions as new sections. The audit trail matters more than tidiness.
