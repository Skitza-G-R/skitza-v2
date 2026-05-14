# Phase 3, 4, 5 — Parallel Build Briefs

**Status:** Phase 1 + 2 merged into `v3-clean`. Phases 3, 4, 5 run in parallel chats off latest `v3-clean`. Merge order: 3 → 4 → 5.

**Strategic chat owns coordination.** Build chats must escalate scope decisions (new primitives, new deps, contradictions in the design) instead of guessing.

---

## Cross-cutting decisions (apply to all 3 phases)

These are strategic calls made before parallel work started. Not all are in Phase 1/2 handoffs — record them here so build chats inherit them.

**Responsive breakpoint**
- `lg:` (≥1024px) = desktop UI
- `<lg:` (<1024px) = mobile UI
- Applies to both artist and producer (Raz approved mobile producer for v1)
- iPads in both orientations get mobile UI (touch-optimized)

**Producer mobile is in v1 scope**
- CLAUDE.md says "desktop only for producer" — that line is OUTDATED
- Raz approved mobile producer on 2026-05-05 (verbal, in chat with Gili)
- CLAUDE.md update is a separate doc-only PR, not blocking
- Phase 4 must build BOTH desktop and mobile producer

**Producer nav: 6 items, no Insights**
- Design's `shell.jsx` includes an "Insights" tab — `/dashboard/insights` route DOES NOT EXIST
- Drop Insights from nav (already done in Phase 2)
- Final 6 producer nav items map to existing routes:
  | Design label | Route |
  |---|---|
  | Overview | `/dashboard` |
  | Projects | `/dashboard/clients-projects` |
  | Music | `/dashboard/music` |
  | Calendar | `/dashboard/calendar` |
  | Store | `/dashboard/profile` |
  | Settings | `/dashboard/settings` |

**CommandPalette redesign = Phase 4**
- Phase 2 left ⌘K functional but visually un-redesigned
- Apply new tokens in Phase 4 (producer phase) since command palette is producer-facing
- Data wiring stays as-is

**FloatingPlayer slot = Phase 5 fill**
- Phase 2 reserved a layout slot for FloatingPlayer (see `phase-2-handoff.md` for slot contract)
- Phase 5 fills it (artist plays music, owns the player)
- Uses existing `wavesurfer.js` integration — style the wrapper, do NOT modify waveform logic

**Clerk auth UI**
- Use Clerk `<UserButton>` with `appearance` prop styled to design tokens
- DO NOT roll a custom auth dropdown — would break sign-out + account-switching
- For sign-in / sign-up flows: prefer styled `<SignIn />` / `<SignUp />` over Clerk Elements unless design demands custom UI
- If Clerk's `appearance` API can't match design, build chat must STOP and escalate to Strategic Lead

**Primitive coordination (critical for parallel work)**
- Phase 1 deferred 8 primitives (Sheet, Popover, Tooltip, Dropdown Menu, Tabs, Accordion, Radix Select, Command). See `phase-1-handoff.md` for the full list.
- Phase 2 may have added 1-2 (check `phase-2-handoff.md`)
- **If a Phase 3/4/5 chat needs a remaining deferred primitive, it MUST stop and ask Strategic Lead first**
- Strategic Lead decides who builds it (usually whichever phase needs it first)
- Other phases import after that PR merges

**No new deps without approval**
- Inline SVGs for icons (no `lucide-react` — Phase 1+2 precedent)
- If a phase genuinely needs a new dep (e.g. calendar lib, drag-drop), STOP and escalate

**Branch + merge rules**
- All 3 branches off LATEST `v3-clean` (after Phase 2 merge)
- Branch names: `phase-3-public`, `phase-4-producer`, `phase-5-artist`
- PR base: `v3-clean`
- **Merge order: 3 → 4 → 5** (highest visibility first)
- Each PR rebases on latest `v3-clean` before merging
- Direct push to `v3-clean` only for docs-only changes (CI does not run on direct push to non-main branches per `.github/workflows/ci.yml`)

**Testing**
- Test in REAL browser at `localhost:3000` — Claude preview pane cannot follow Clerk auth redirects (known limitation, not a bug)
- Use Vercel preview URL on the PR for Raz review
- Each chat runs same 22-style verification before claiming done

**Cleanup discipline**
- If a chat creates test users via API (Clerk or DB) for verification screenshots, it MUST delete them before stopping
- No orphan data in dev environment

---

## Phase 3 brief — Public routes (landing + auth)

```
Task: Phase 3 — Public routes (landing, auth, legal)

Read first, in order:
1. CLAUDE.md
2. docs/qa/phase-1-handoff.md
3. docs/qa/phase-2-handoff.md
4. docs/qa/phase-3-4-5-briefs.md (this file — cross-cutting decisions)
5. ~/Downloads/skitza (1)/notes/skitza-context.txt
6. ~/Downloads/skitza (1)/notes/design-system.md
7. ~/Downloads/skitza (1)/index.html — landing page
8. ~/Downloads/skitza (1)/styles.css
9. Find auth screens — run:
   grep -ril "sign-in\|sign-up\|signin\|signup\|auth" "$HOME/Downloads/skitza (1)/"
   Read whatever surfaces. Likely embedded in app.jsx, design-canvas.jsx, or as part of index.html. If no auth screens exist in the zip, flag back to Strategic Lead and we use Clerk's default <SignIn /> / <SignUp /> styled to match design tokens.

After reading, summarize back to me in 5 bullets:
- Landing page structure (sections, hero, CTAs)
- Animation approach (CSS-only? JS? GSAP? Lottie?)
- Auth design approach (custom UI requiring Clerk Elements, OR styled <SignIn />)
- Fonts used (any new ones beyond Outfit + Syne?)
- Any deferred primitives you'll need (Sheet, Popover, Tooltip, etc.)

Wait for Strategic Lead "go" before writing code.

Branch: phase-3-public off latest v3-clean
Baseline: pnpm typecheck && pnpm test && pnpm lint must be green before first edit

Scope — what to build:
- / (landing)
- /sign-in
- /sign-up
- /join/[slug] (artist signup via producer link — preserve role-assignment logic from Clerk webhook)
- /privacy, /terms, /about (legal — apply new tokens, content unchanged)

Hard out-of-scope — DO NOT touch:
- app/(producer)/**
- app/(artist)/**
- tRPC routers, DB schema, Clerk webhook logic
- Existing primitives, layouts, shells (Phase 1 + 2)
- Existing tokens in globals.css (you may ADD new tokens; do not modify existing)

Discipline rules:
- No new deps without asking Strategic Lead
- Inline SVGs (no lucide-react — Phase 1 + 2 precedent)
- CSS-only animations preserved — landing is performance-tuned for Core Web Vitals. JS animations require Strategic Lead approval.
- If you need a deferred primitive (Sheet, Popover, Tooltip, etc.), STOP and ask Strategic Lead FIRST. Phase 4 + 5 chats are running in parallel — Strategic Lead coordinates so we don't ship 3 different versions.
- Test in real browser at localhost:3000, not Claude preview pane (Clerk redirect issue)

Output: PR `chore(ui): phase 3 — landing + auth`. Base: v3-clean. Screenshots: landing desktop + mobile, sign-in, sign-up, /join/[slug] flow.

Handoff: docs/qa/phase-3-handoff.md.
```

---

## Phase 4 brief — Producer dashboard pages

```
Task: Phase 4 — Producer dashboard pages

Read first, in order:
1. CLAUDE.md
2. docs/qa/phase-1-handoff.md
3. docs/qa/phase-2-handoff.md
4. docs/qa/phase-3-4-5-briefs.md (this file — cross-cutting decisions)
5. ~/Downloads/skitza (1)/notes/skitza-context.txt
6. ~/Downloads/skitza (1)/notes/design-system.md
7. ~/Downloads/skitza (1)/producer-screens.jsx
8. ~/Downloads/skitza (1)/producer-screens-2.jsx
9. ~/Downloads/skitza (1)/data.producer.jsx
10. ~/Downloads/skitza (1)/producer.html

After reading, summarize back to me in 5 bullets:
- What each of the 6 producer screens contains
- Mobile vs desktop differences per screen
- Any new data shapes implied (vs existing tRPC routers)
- Which deferred primitives you'll need (Sheet, Popover, Tooltip, etc.)
- Any new dependencies you think you'll need (charts, drag-drop, calendar lib, etc.)

Wait for Strategic Lead "go" before writing code.

Branch: phase-4-producer off latest v3-clean
Baseline: typecheck + test + lint green first

Scope — 6 routes (CLAUDE.md mapping):
| Route                       | Design label        |
|-----------------------------|---------------------|
| /dashboard                  | Overview / "Today"  |
| /dashboard/profile          | Storefront / "Store"|
| /dashboard/calendar         | Calendar            |
| /dashboard/clients-projects | Projects            |
| /dashboard/music            | Music               |
| /dashboard/settings         | Settings            |

Both desktop ≥1024px AND mobile <1024px — Raz approved mobile producer for v1 (overrides CLAUDE.md's outdated "desktop only" line).

CommandPalette redesign included in this phase — Phase 2 left it functional but visually un-redesigned. Apply new tokens. Data wiring stays as-is.

Hard out-of-scope — DO NOT touch:
- Auth, landing, legal → Phase 3
- app/(artist)/** → Phase 5
- tRPC routers, DB schema, server logic
- Layouts, shells, nav (Phase 2)
- Existing primitives (Phase 1)

Discipline rules: Same as Phase 3. Stop and ask Strategic Lead before adding new primitives or new deps.

Output: PR `chore(ui): phase 4 — producer pages`. Base: v3-clean. Screenshots: each of the 6 pages, both widths (12 screenshots).

Handoff: docs/qa/phase-4-handoff.md.
```

---

## Phase 5 brief — Artist platform pages

```
Task: Phase 5 — Artist platform pages

Read first, in order:
1. CLAUDE.md
2. docs/qa/phase-1-handoff.md
3. docs/qa/phase-2-handoff.md
4. docs/qa/phase-3-4-5-briefs.md (this file — cross-cutting decisions)
5. ~/Downloads/skitza (1)/notes/skitza-context.txt
6. ~/Downloads/skitza (1)/notes/design-system.md
7. ~/Downloads/skitza (1)/screens.artist-desktop-1.jsx
8. ~/Downloads/skitza (1)/screens.artist-desktop-2.jsx
9. ~/Downloads/skitza (1)/screens/home.jsx
10. ~/Downloads/skitza (1)/screens/music.jsx
11. ~/Downloads/skitza (1)/screens/book.jsx
12. ~/Downloads/skitza (1)/screens/store-settings.jsx
13. ~/Downloads/skitza (1)/screens/booking-artboards.jsx
14. ~/Downloads/skitza (1)/data.artist.jsx
15. ~/Downloads/skitza (1)/booking-flow.html
16. ~/Downloads/skitza (1)/artist.html
17. ~/Downloads/skitza (1)/artist-desktop.html

After reading, summarize back to me in 5 bullets:
- What each artist screen contains (5 routes × mobile + desktop)
- Song page approach — mobile Spotify-style + desktop waveform (most complex screen)
- FloatingPlayer integration approach (Phase 2 reserved a slot — describe how you'll fill it)
- Booking flow approach (multi-step? single page?)
- Which deferred primitives + new deps you'll need

Wait for Strategic Lead "go" before writing code.

Branch: phase-5-artist off latest v3-clean
Baseline: typecheck + test + lint green first

Scope — 5 routes:
| Route             | Design                                                           |
|-------------------|------------------------------------------------------------------|
| /artist           | Dashboard (upcoming sessions, recent uploads, balances)          |
| /artist/music     | Music library + song detail (mobile Spotify-style; desktop wave) |
| /artist/book      | Book sessions                                                    |
| /artist/store     | Storefront browse                                                |
| /artist/settings  | Artist settings                                                  |

Both desktop ≥1024px AND mobile <1024px.

FloatingPlayer: Phase 2 reserved a layout slot (see phase-2-handoff.md for slot contract). Fill it with the new design. This is where audio playback lives — uses existing wavesurfer.js.

Hard out-of-scope — DO NOT touch:
- Auth, landing, legal → Phase 3
- app/(producer)/** → Phase 4
- tRPC routers, DB schema, server logic
- Layouts, shells, nav (Phase 2)
- Existing primitives (Phase 1)
- wavesurfer.js core integration (style the wrapper, don't change waveform logic)

Discipline rules: Same as Phase 3 + 4. Stop and ask Strategic Lead before adding new primitives or new deps.

Output: PR `chore(ui): phase 5 — artist pages`. Base: v3-clean. Screenshots: each of the 5 routes, both widths, plus song page mobile + desktop separately (12 screenshots minimum).

Handoff: docs/qa/phase-5-handoff.md.
```

---

## Pre-flight checklist (before firing the 3 chats)

- [ ] Phase 2 PR #56 merged into `v3-clean`
- [ ] Phase 2 final state pushed to `phase-2-handoff.md` (with merge SHA)
- [ ] `phase-2-shells` branch deleted (origin + local)
- [ ] F4 stash popped on `v3-clean` as uncommitted WIP (don't lose this)
- [ ] `~/Downloads/skitza (1)/` exists and contains design source (or update path in briefs)
- [ ] Raz notified: "3 PRs incoming for Phase 3, 4, 5 in parallel — review order 3 → 4 → 5, ~30 min per PR"
- [ ] This file (`phase-3-4-5-briefs.md`) committed to `v3-clean`

## Verification prompt for end-of-phase (reuse from Phase 1)

When any phase chat says "done", send the same 22-check verification pattern from Phase 1's verification prompt. Adapt items to the specific phase's scope, but keep the principle: re-run all commands fresh, paste actual output, no vague summaries, no ❌ left unresolved.
