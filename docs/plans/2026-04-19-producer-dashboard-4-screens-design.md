# Producer Dashboard — 4-Screen Refactor Design

**Feature:** Collapse the producer dashboard from 10 top-level nav items into 4 screens + a global command layer. Match the Linear / Stripe Dashboard / Spotify design philosophy: few screens with depth, context-rich detail surfaces, keyboard-first for power users.

**Why now:** The current dashboard (Pipeline · Clients · Leads · Projects · Bookings · Contracts · Invoices · Portfolio · Library · Inbox · Settings) is the HoneyBook/Dubsado anti-pattern — "lacking a centralized dashboard for easier management" and "cluttered interface" per documented user complaints. Skitza's design thesis is the opposite: **feature-rich with few screens**. Every day a producer spends clicking between 10 tabs is a day they're not making music.

---

## Goals

1. **4 top-level screens** on mobile (bottom tabs) and desktop (sidebar). No hamburger menu. No buried features.
2. **Project-centric navigation**: 95% of producer time lives inside one project's room. Contracts, invoices, bookings, tracks — all sub-tabs of the project, not separate pages.
3. **Global command palette (⌘K)**: reach anything by name. Replaces directory-style navigation.
4. **No new admin work**: screens render *state* (what the app already knows); producer actions are inline CTAs at the point of relevance.

## Non-goals (this milestone)

- New business logic — this is a UI refactor. No new tRPC mutations, no schema changes required.
- Mobile native app — still a responsive web + Tauri Mac shell.
- Themeable brand customization for the producer's own dashboard — Setup already handles it.
- The artist-side UI (separate `/artist` surface, already shipped).

---

## Research validation

Design validated against 8 sources on SaaS UX patterns:

| Claim | Evidence |
|---|---|
| 4 bottom tabs (mobile) | Gold standard; 38% engagement lift in a real case study of replacing hamburger menus with tab bars |
| Sidebar (desktop) | What Linear, Vercel, Stripe, Notion do. Our 4 items is *under* typical sidebar capacity — a feature for our "simple as possible" thesis |
| ⌘K command palette | Universally adopted across top SaaS: Linear, Figma, Notion, Vercel, Raycast, Superhuman, Slack. Response target 50-60ms. |
| Project-centric navigation | Linear's philosophy: "defaults to a clean, whitespace-heavy issue list with zero visual noise, where power features exist but aren't in your face until you need them" |
| 5-step timeline (not 8) | Research: 3-6 steps optimal for stepper UIs. 8 overwhelms. |
| 4 sub-tabs (not 6) | Research: "stick to two levels of tab depth"; 6 sub-tabs strain the mobile adaptation |
| Empty states as feature | "Most overlooked UX pattern in modern frontend." Each screen gets a thoughtful empty state. |
| Split-inbox layout | Linear's pattern for the Today screen's list+detail pane |
| Top metric strip | Stripe's pattern: 4-6 KPIs in the top 80-120px of the dashboard |

---

## Confirmed decisions

| Question | Answer |
|---|---|
| How many screens? | **4 + global command layer** |
| Which 4? | Today · Project Room · Music · Setup |
| Keep Kanban/Pipeline view? | **Kill entirely.** Today's list + saved views replace it. A separate Kanban doesn't earn its UI cost. |
| Mobile nav? | **Bottom tab bar**, 4 tabs. Project Room opens full-screen from any tap. |
| Desktop nav? | **Sidebar**, 4 items + ⌘K search at top |
| Command palette? | **Yes** — ⌘K (Mac) / Ctrl+K (Win/Linux). Fuzzy-search everything. |
| Keyboard shortcuts? | **Layered in.** N for new, E for edit, / for search, Esc to close. Non-intrusive. |
| Notification inbox? | **Bell icon dropdown** in header (Linear-style), not a separate top-level page. |
| URL preservation? | **Old URLs 301-redirect** to new equivalents. Emails with links to /dashboard/contracts etc. don't break. |

---

## The 4 screens

### 1. Today (`/dashboard`)

The producer's landing page. Replaces the current Kanban pipeline + Inbox + a few other things.

**Desktop (≥1024px): Split-inbox layout**
```
┌─────────────────────────────────┬──────────────────────────────┐
│ Today — Sunday April 19         │                              │
│ ─────────────────────────────── │                              │
│ 🎙 Session with Dan · 14:00  ›  │   [Selected item detail]     │
│ 💬 Dan commented on V2 · 1:42   │                              │
│ 💳 ₪2,500 due from Yossi · May18│   + inline actions           │
│ 🆕 New inquiry from Insta       │                              │
│ ─────────────────────────────── │                              │
│ [Saved views ▾]                 │                              │
└─────────────────────────────────┴──────────────────────────────┘
```

**Top strip (KPIs, both mobile + desktop):**
- Active projects (count)
- Revenue this month (₪)
- Upcoming sessions (next 7 days)
- Unresolved items (unpaid invoices + open comments)

**List rows (unified, sorted by urgency):**
- Today's sessions (with Waze link)
- Unresolved comments (tap → Project Room · Music sub-tab at the commented track)
- Overdue invoices + next scheduled charges
- New leads (booking requests, magic-link views)

**Saved views** (Linear pattern) — producer can save filter combinations:
- "My 2 active album projects"
- "Clients with unpaid invoices"
- "This week"

**Empty state**: "All caught up. Next session tomorrow at 14:00." (calm, not alarming)

**Mobile**: list-only view; tap any item → full-screen detail with a back arrow. Top KPI strip condenses to a horizontal rotator OR single summary line.

---

### 2. Project Room (`/dashboard/projects/<id>`)

Where 95% of the producer's time lives. Everything about one engagement with one client, on one screen.

**Header (always visible):**

```
[Avatar] Dan Cohen  ·  [Stage: In Progress ▾]  ·  [⋯ Actions ▾]
```

**Payment status strip** (the one we already built for auto-installments):
```
₪10,000 · 4 monthly × ₪2,500   ●●○○   2/4 paid   ·   Next: May 18
```

**5-step timeline:**
```
Trial ✓ → Contract ✓ → In Progress ← (you are here) → Final → Paid
```

Auto-advances on triggers:
- Contract → when client signs
- In Progress → when first charge lands
- Final → when producer clicks "Mark final delivered"
- Paid → when last charge lands

**Sub-tabs (4):**

| Sub-tab | What's there |
|---|---|
| **Music** | All this project's tracks + versions + timestamped comments. Drag-drop upload zone at top. Latest version auto-selected. |
| **Sessions** | Past + upcoming bookings for this project. "New session" button (opens calendar picker). |
| **Money** | Contract PDF (read-mostly) + invoices ledger (each row: amount, status, Stripe link) |
| **Notes** | Producer-private notes. Markdown-ish text area + tags. |

Each sub-tab has an optional "timeline view" filter — shows the same data sorted chronologically as an activity feed.

**Side panel (desktop only, bottom-sheet on mobile):**
- Client contact: email, phone, tags
- "Copy magic link" (share project access with client)
- "Open in Stripe" (payment troubleshooting)
- Recent activity (last 5 events)

**Mobile adaptation:**
- Header + payment strip + timeline collapse to compact single-line form
- Sub-tabs as 4-pill segmented control (all visible, no scroll)
- Side panel → "Client info" bottom sheet (tap avatar)

**Empty state (new project)**: Each timeline step has an inline CTA when it's the active step:
- Contract step active → "Send the contract" button
- In Progress active → "Upload first mix" or "Book next session"
- Final active → "Mark final delivered"

---

### 3. Music (`/dashboard/music`)

The Samply-vibe cross-project library. All your tracks across all projects in one place.

**Layout:**
```
Music
──────────────────────────
[Filter: All projects ▾] [Sort: Latest ▾]

🎵 Summer Single (V3 — Master)      Dan Cohen   · 2h ago
🎵 Winter Rough                     Noa Kirel   · 5h ago
🎵 Album Track 3 (V1)               Eyal Golan  · yesterday
...
```

Tap a row → routes to that track's Project Room on the Music sub-tab, track auto-selected, ready to play.

**Persistent mini-player** at the bottom (same pattern we built for the artist app) — playback continues as you navigate between tabs.

**Why this is its own top-level screen** (not a sub-tab of Project Room):
- Cross-project scanning: "What am I working on this week?"
- Quick re-listen to recent mixes without hunting for the project
- Samply-style quick-share: "Send V2 to my collaborator" → generates a magic link

**Empty state**: "No tracks yet. Drag a WAV here to start." (drop zone covers the full area)

---

### 4. Setup (`/dashboard/settings`)

Configuration screen. Touched twice a year, not daily.

**Sections (accordion or cards):**
- **Services catalog** (formerly Packages/Products) — create, edit, archive products
- **Availability** — weekly morning/evening blocks, blackouts
- **Portfolio** — public portfolio track list, brand colors, logo
- **Connections** — Stripe Connect status, Google Calendar sync (future), webhook secret
- **Notifications** — preferences for push/email (future)
- **Account** — email, name, sign out

Each section collapsed by default; expand-on-click. Don't dump 50 fields on one scroll.

**Why it's its own screen**: Configuration doesn't belong inside Project Room (would clutter 95% of the producer's daily UI with twice-a-year fields). Setup's own page lets it breathe.

---

## Global command layer

### ⌘K command palette

Triggered by ⌘K (Mac) / Ctrl+K (Win/Linux) / tapping a search icon in the top bar.

**Search scope:**
- Clients (by name or email)
- Projects (by title)
- Tracks (by title)
- Services (by product name)
- Commands (by action name: "Create project", "Send invoice", "Go to Setup")

**Structure:**
```
[⌘K] Search or type a command…
─────────────────────────────
Recent
  Dan Cohen · Active project
  Noa Kirel · Paid
  Summer Single V3

Commands
  ⌘N  New project
  ⌘↑  Go to Today
  /   Focus search
```

Response time target: 50-60ms (per Superhuman research).

### Keyboard shortcuts (non-intrusive layer)

| Shortcut | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Open command palette |
| `N` | New project (or contextual: new note, new session depending on scope) |
| `E` | Edit current selection |
| `/` | Focus search within current view |
| `G` then `T` | Go to Today |
| `G` then `P` | Go to active Project Room |
| `G` then `M` | Go to Music |
| `G` then `S` | Go to Setup |
| `Esc` | Close modal / back to parent view |

Discoverable via ⌘K listing, but no visual UI takes up space.

### Notification bell (Linear-style)

Bell icon in the header. Click opens a dropdown with:
- Unread: comments on your mixes, new bookings, payment events, etc.
- "Mark all read"
- "Settings" link → Setup > Notifications

---

## Kill list (screens that go away)

| Old URL | Becomes | Redirect? |
|---|---|---|
| `/dashboard/pipeline` (Kanban) | killed — Today's list replaces | 301 → `/dashboard` |
| `/dashboard/clients` | killed — ⌘K search + client info in Project Room | 301 → `/dashboard` (user searches) |
| `/dashboard/clients/[id]` | → `/dashboard/projects/[projectId]` (most recent active project for that client) | 302 → project lookup |
| `/dashboard/leads` | killed — Today shows new inquiries | 301 → `/dashboard` |
| `/dashboard/leads/[id]` | → `/dashboard/projects/[projectId]` | 302 → project lookup |
| `/dashboard/projects` (list) | → `/dashboard/music` (closest equivalent — library of work) | 301 |
| `/dashboard/bookings` | killed — Sessions is a Project Room sub-tab | 301 → `/dashboard` |
| `/dashboard/contracts` | killed — Money sub-tab inside Project Room | 301 → `/dashboard` |
| `/dashboard/contracts/[id]` | → `/dashboard/projects/[projectId]?tab=money` | 302 → project lookup |
| `/dashboard/contracts/new` | killed — new-contract flow is inline on Project Room | 301 → `/dashboard` |
| `/dashboard/invoices` | killed — Money sub-tab + Today | 301 → `/dashboard` |
| `/dashboard/portfolio` | → `/dashboard/settings?section=portfolio` | 302 |
| `/dashboard/library` | → `/dashboard/music` | 301 |
| `/dashboard/inbox` | killed — bell dropdown | 301 → `/dashboard` |
| `/dashboard/booking` (availability config) | → `/dashboard/settings?section=availability` | 302 |
| `/dashboard/settings` | stays — evolves into full Setup screen | — |
| `/dashboard` | stays — evolves into Today | — |
| `/dashboard/projects/[id]` | stays — evolves into Project Room | — |
| `/dashboard/music` | NEW | — |

---

## Tech stack (mostly reused)

No new dependencies. Everything runs on:
- **Next.js 15 App Router** — route group `(app)/dashboard/*`
- **tRPC v11** — reuse existing `producerRouter`, `projectRouter`, `contractRouter`, `invoicesRouter`, etc. No new backend procedures (this is a UI refactor).
- **Drizzle + Neon** — no schema changes
- **Tailwind v4 + CSS vars** — reuse existing design tokens (`--brand-primary`, `--bg-elevated`, etc.)
- **wavesurfer.js** — reuse for Music tab audio
- **New dependency (minor)**: `cmdk` for the command palette — 15kb gzipped, used by Linear/Vercel
- **Keyboard shortcuts**: plain event listeners on `document`, no new library

---

## Data flow summary

- **No new migrations**. The data exists; only the UI changes.
- **Today** aggregates across projects — reuses `artist.home`-style parallel queries but from the producer's perspective (via `producerProcedure`).
- **Project Room** loads a single project with nested tracks/invoices/contract — reuses existing `project.byId`-shaped query.
- **Music** lists all tracks across producer's projects — new `producer.music.list` query (simple aggregation).
- **Setup** is form-driven — reuses existing producer/product/availability routers.

---

## Accessibility + mobile touchpoints

- **Focus management**: modal dialogs trap focus; `Esc` closes and returns focus to invoking button.
- **Keyboard navigation**: all tabs/menus reachable via Tab; current tab indicated via `aria-current`.
- **ARIA live regions**: new notifications announced to screen readers.
- **Mobile touch targets**: min 44×44px per iOS HIG. Bottom tab bar safely above home-indicator area.
- **Dark mode**: respected via CSS vars — no hardcoded colors.

---

## Effort estimate

12-15 tasks, same scale as the artist app build. ~2 days of autonomous subagent-driven work.

**Major task categories:**
1. New route: `/dashboard/music` + its tRPC query
2. Refactor `/dashboard` landing into Today (split-inbox + KPI strip)
3. Refactor `/dashboard/projects/[id]` into Project Room (5-step timeline + 4 sub-tabs, absorbing contracts/invoices/bookings/notes)
4. Refactor `/dashboard/settings` into full Setup screen (absorbing portfolio + availability + booking config)
5. Delete + 301/302 redirect old top-level routes (clients, leads, bookings, contracts, invoices, portfolio, library, inbox, pipeline)
6. Sidebar + bottom-tab AppShell update (4 items instead of 10)
7. ⌘K command palette (new component using `cmdk`)
8. Keyboard shortcuts layer
9. Bell-icon notification inbox
10. Empty states for each screen
11. Tests for redirects + new routes + command palette
12. Manual QA + production rollout

---

## Open questions / explicit deferrals

- **Saved views** — planned for Today but the backend persistence can be Phase 2 (URL-based filters work day 1; saving them requires a new table).
- **Cross-project revenue charts** — Today has 4 KPIs; deeper analytics deferred.
- **Producer mobile native app** — PWA + Tauri Mac covers it for now.
- **Offline mode** — deferred; online-only for this refactor.
