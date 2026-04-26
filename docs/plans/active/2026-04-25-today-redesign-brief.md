# Today dashboard redesign — Brief

**Date:** 2026-04-25
**Track:** BMAD Large
**Trigger:** User feedback after polish PR #47 landed: "design is not human-behavior designed, too many buttons, size hierarchy is not there, timeline is stretched and ugly."
**Predecessor:** PR #47 (polish pass — pill swap, URL chip, chart guides, sidebar shortcuts inline). Polish ships visible improvements but doesn't fix the underlying architecture problem: the page is structured around what the codebase *can render* rather than what a producer actually *does at 9am*.

---

## Why we're rebuilding (not polishing)

A producer opens Skitza in the morning. Their mental sequence is:

1. **Respond.** "What needs me? — comments, invoices, booking requests."
2. **Produce.** "What am I currently working on? — let me hear last night's mix from a fresh ear."
3. **Status.** "How am I doing this month? — quick glance, not a deep dive."

The current Today screen answers those questions in **the wrong order** and with **the wrong volume**:

- ShareLinkCard hero (a config setting) is the page's loudest element
- 8 QuickActions buttons before any data appears
- KPI strip in display-4xl shows zeros to new producers (wall of nothing)
- 600×200 revenue chart that's wider than tall, no Y-axis labels, looks like a flat horizon
- Inbox is below the fold

The redesign inverts the stack: **inbox first → uploads middle → pulse bottom**. Configuration moves to the chrome (sidebar share-link footer). The 8-button strip becomes 3 context-aware cards. The chart moves to its own drill-down route.

---

## Success signals (how we know it worked)

1. **Time-to-first-action drops.** Producer signs in → first click on an inbox item happens within 5 seconds (currently ~12s by user observation; they have to scroll past 4 layers of furniture).
2. **Empty-state day-1 producers don't see zeros.** They see one onboarding card pointing them to share their link. The populated dashboard appears automatically when data exists.
3. **Visual hierarchy passes the squint test.** Squint at the page — the inbox heading dominates; the pulse number is the second loudest element; everything else is subordinate. No more three-tier H2 size confusion.
4. **The audio surfaces.** Recent uploads as cover-art shelf gives ambient access to the producer's last 5 in-flight tracks without navigating to the Music tab.

---

## Scope

### In scope (this redesign)

- **Replace** ShareLinkCard hero on Today with a sidebar share-link footer chip
- **Replace** KpiStrip + RevenueTrend on Today with a single PulseCard (one big number + 30d sparkline + footer counts)
- **Replace** QuickActions strip (8 buttons) with ContextualActions (3 dynamic cards)
- **Add** RecentUploadsShelf — horizontal cover-art shelf, last 5 track-version uploads across active projects, comment-count badge per card, deep-link to Project Room music tab
- **Move** the 6-month deep chart to a new `/dashboard/revenue` route
- **Invert** Today's layout: inbox at top, recent uploads middle, pulse + actions bottom
- **New** `producer.today` payload shape: adds `recentUploads` + `pulseStats` (delta + sparkline points)
- **Empty state** — day-1 producers see a single onboarding card, not the populated layout with zeros

### Out of scope (future passes)

- Waveform-image cover art (use deterministic gradient covers in v1)
- "Now playing" persistent player redesign (existing PersistentPlayer reused as-is)
- Revenue page deep features (drill-down, MoM/YoY toggles, export) — v1 of `/dashboard/revenue` is just a host page for the existing `RevenueTrend` chart at a more breathable size
- Sidebar redesign (the Linear/Splice-flavoured sidebar stays; only the footer share-link chip is added)
- Mobile-specific layout (CSS-driven responsive only — no separate mobile-only component)

---

## Hard constraints

- **No new design tokens.** Reuse the existing CSS-var palette + animation primitives (`sk-lift`, `sk-pop`, `sk-trans`, `sk-num`).
- **No framer-motion or chart libraries.** Continue rolling SVG inline + CSS-keyframes for charts/animation.
- **No new dependencies.**
- **All audio reuses the PersistentPlayer.** Click play on a recent-uploads card → existing player surfaces.
- **One round-trip data fetch on Today.** Extend `producer.today` rather than adding a new procedure.
- **Tenant scoping by `producerId` on every query** (per CLAUDE.md mistake log + `findPredicate` test pattern).
- **Migration path:** zero new DB columns. The redesign is pure UI + tRPC fan-out additions. The existing `recentTrackVersions` data is queryable from existing tables.

---

## Risks

| Risk | Mitigation |
|---|---|
| Producers miss the share link (it moved to sidebar) | Sidebar chip with copy button is always visible on every page; link still copyable from the cheatsheet `?` and via ⌘K palette |
| Day-1 producers feel less guided without QuickActions buttons | Empty-state Today shows one large onboarding card with the share link + "your first booking is one share away" — replaces the 8-button strip's implicit "you have options" with explicit "do this one thing" |
| ContextualActions algorithm picks wrong actions (looks dumb) | Story 4 specifies the priority rules explicitly; QA reviews on test fixtures with 5+ producer states (zero data / 1 unread comment / 1 overdue invoice / etc.) |
| Recent uploads with no cover art look bland | Deterministic gradient covers indexed by track id hash — visually distinct, requires zero asset infrastructure |
| Migration to /dashboard/revenue breaks bookmarks pointing at Today's chart | No bookmarks point there — the chart was inline on Today, not a discrete URL |
