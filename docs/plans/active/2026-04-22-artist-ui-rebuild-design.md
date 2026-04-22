# Artist UI Rebuild — Design Brief

> **For Claude:** This is the design phase of audit Task 17 (see `docs/audit-report.md`). It is NOT an implementation plan yet — Gili must approve this brief before any code is written. Once approved, convert this into an implementation plan under the same filename with `-design` removed.

**Date:** 2026-04-22
**Author:** Claude (from Gili's scope answers in chat)
**Status:** 📐 Pending Gili's approval
**Related:** `docs/audit-report.md` Task 17 · `docs/product/PRD.md` §6 (artist app)

---

## 1. Why we're doing this

Gili's manual QA of the `/artist` page on 2026-04-22:

> "The /artist UI looks cheap, barebones, and is missing basic controls like a Logout button. It doesn't feel like my app, even if you match it to the producer mobile app."

Screenshot showed: a cream-colored desktop browser window with three sparse cards (Next Session / Latest Mix / Activity), a bottom-fixed tab bar that feels mobile-only on desktop, and no header chrome — no Skitza logo, no UserButton, no settings access.

The **artist app is the client-facing product producers are paying for**. It has to feel first-class. Producers won't sell their clients on a CRM whose client side looks like an MVP stub.

## 2. Scope (confirmed with Gili in chat, 2026-04-22)

- **Feature set stays artist-only.** No producer features bleeding in. The 4 tabs (Home / Music / Book / Store) are the right surface area.
- **Desktop must feel like the producer desktop side.** That means a proper sidebar navigation (not just a bottom bar stretched across a wide viewport), UserButton in the chrome, a Skitza brand element.
- **Mobile stays bottom-nav PWA-style.** This is intentional — the client experience on phone is supposed to feel like Spotify for Artists, not a shrunken desktop CRM.
- **Real Settings page** at `/artist/settings`. Not just Clerk's account modal.
- **Sign-out lands on `/`** (marketing page) for now. Later, when this goes native, it'll be a branded "welcome back / sign in" screen.

## 3. Architecture (proposed)

### 3.1 Responsive shell

Split `ArtistAppShell` into two visual layouts behind a single component, switched by Tailwind breakpoint:

- **Mobile (`< md`)**: the current shell unchanged — top StudioSwitcher header, content, PersistentMiniPlayer, BottomNav. Add a UserButton in the top-right of the header.
- **Desktop (`≥ md`)**: a new sidebar layout matching the producer's visual density — left sidebar (Skitza wordmark + primary nav + studio switcher + UserButton in footer), main content, no bottom nav, PersistentMiniPlayer docked at the bottom-right.

Both layouts share the same `ArtistAudioProvider` + same tRPC data. Only the chrome differs.

### 3.2 Desktop sidebar — proposed layout

```
┌──────────────────────┬─────────────────────────────────────────┐
│                      │                                         │
│  ◎ Skitza            │                                         │
│                      │                                         │
│  ──── Studio ────    │                                         │
│  ▼ Gili Asraf        │           main content area             │
│    (studio switcher) │                                         │
│                      │           (same as mobile /artist       │
│  ──── Navigate ────  │            pages, desktop-widthed)      │
│  🏠 Home             │                                         │
│  🎵 Music            │                                         │
│  📅 Book             │                                         │
│  🛍️ Store            │                                         │
│                      │                                         │
│                      │                                         │
│  ⚙️ Settings         │                                         │
│                      │                            ┌──────────┐ │
│                      │                            │ 🎵 now   │ │
│  [avatar]            │                            │ playing  │ │
│  Gili                │                            └──────────┘ │
│  (UserButton)        │                                         │
└──────────────────────┴─────────────────────────────────────────┘
```

Reuses the producer sidebar's visual language (same border colors, spacing, typography tokens) but with an artist-appropriate nav tree.

### 3.3 Components — reuse vs new

**Reuse from producer side (`apps/web/src/components/shell/*`):**
- Visual tokens only — same `rgb(var(--bg-elevated))`, `--border-subtle`, etc.
- Possibly `NotificationBell` if artists get notifications (e.g. new mix uploaded, payment due). Flag for Q-during-implementation.

**Re-skin from artist side:**
- `StudioSwitcher` — already exists, relocate into sidebar.
- `PersistentMiniPlayer` — keep on both mobile + desktop.
- `BottomNav` — mobile-only via `md:hidden`.

**New:**
- `ArtistSidebar` component — the desktop chrome.
- `/artist/settings` page — language switcher, notification prefs (stub for now), account button (opens UserButton modal).
- `UserButton` integration — theme it via `appearance` prop to match our palette. Same config as `components/shell/sidebar.tsx` probably.

### 3.4 Routes — what's new

- `/artist/settings/page.tsx` — new.
- Everything else existing (`/artist`, `/artist/music`, `/artist/book`, `/artist/store`) keeps its URL and data layer — only the wrapping chrome changes.

## 4. Implementation plan — phased

I'll break this into 3 commits on the existing PR #30 branch. Each commit is independently revertible if one phase regresses.

### Phase 1: Functional unblock (`fix(artist): add UserButton + sign-out`)
- Add `<UserButton afterSignOutUrl="/" />` to the existing `ArtistAppShell` header (mobile + desktop top-right).
- Theme it to match the brand palette.
- Verify it renders, opens Clerk's account modal, signs out to `/`.
- **Ship-blocker-close. 30-60 min.**

### Phase 2: Desktop sidebar rebuild (`feat(artist): desktop sidebar shell`)
- Create `ArtistSidebar` component using producer visual tokens.
- Split `ArtistAppShell` into mobile (existing) + desktop (new sidebar) branches via Tailwind `md:` breakpoints.
- Move StudioSwitcher + UserButton into the sidebar (desktop only); header stays clean on mobile.
- **The bulk of the work. 3-5 hours.**

### Phase 3: Artist settings page (`feat(artist): /artist/settings`)
- New page at `/artist/settings/page.tsx`.
- Three sections:
  - Account (opens Clerk UserButton modal inline, or links to Clerk's hosted user profile)
  - Language (reuse `components/shell/language-switcher.tsx` — already exists)
  - Notifications (stub with "Coming soon" toggles — real wiring is roadmap S2.3)
- **1-2 hours.**

## 5. Testing strategy

- **Unit tests:** not much to unit-test here — the bulk is JSX rendering. Keep existing behavioral tests (`artist-audio-context.test.ts`, etc.) passing.
- **Visual:** Gili manual-tests each phase on the preview URL. Screenshot review before commit.
- **Regression:** run the full vitest suite after each phase (must stay at 611+ pass).

## 6. What I'll NOT do in this PR

- Real notifications system (roadmap S2.3 — not ready yet).
- Command palette (⌘K) for artists — overkill for this surface, defer.
- Coachmark tour for artists — nice-to-have, defer.
- Rebuilding the 4 main tab pages' content (Home/Music/Book/Store). Only the wrapping chrome changes. If specific cards look sparse after the shell lands, we iterate separately.

## 7. Open questions for Gili before I start

1. **Desktop sidebar: persistent or collapsible?** Producer side has a collapsible sidebar. Artist side — keep always-open (simpler, fewer moving parts) or also collapsible?
2. **Artist-specific notifications:** do artists need a notification bell for "new mix uploaded" / "payment request"? If yes I add it in Phase 2. If no, defer to roadmap.
3. **"Settings" tab in the bottom nav on mobile?** Currently 4 tabs (Home/Music/Book/Store). Adding a 5th would squeeze them. Options:
   - (a) 5 tabs (cramped but obvious)
   - (b) Settings lives in the header top-right on mobile, reachable via avatar tap
   - (c) Settings only reachable via UserButton → "Settings" menu item

## 8. Approval checklist

Before I start coding, Gili confirms:
- [ ] Scope in §2 matches intent
- [ ] Architecture in §3 is acceptable (especially the mobile ≠ desktop split)
- [ ] Phase order in §4 works
- [ ] Open questions in §7 are answered

---

**Once approved → rename this file** by dropping `-design` from the filename, add task-by-task breakdowns per each phase (following the `superpowers:writing-plans` pattern), and start Phase 1.
