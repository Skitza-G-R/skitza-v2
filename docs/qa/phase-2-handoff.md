# Phase 2 — Shells & Navigation Handoff

**Status:** ✅ **Merged into `v3-clean` 2026-05-05 18:16 UTC**
**PR:** [skitza-v2#56](https://github.com/Skitza-G-R/skitza-v2/pull/56) — merged via merge-commit (preserves the 2-commit feature history)
**Merge commit:** [`21c142c`](https://github.com/Skitza-G-R/skitza-v2/commit/21c142cac1eb060673b940500a498dc7921995ff)
**Source branch:** `phase-2-shells` — deleted from origin and locally after merge
**Approver:** Raz (technical co-founder)
**Author:** Gili (with Claude Code)
**Scope:** Replace producer + artist layout chrome with the locked design system shells from `~/Downloads/skitza (1)/`. **No screen contents migrated** — pages render visually mismatched against the new chrome on purpose; that work lives in Phases 3-5.

This document records every shell ported, every component added, every test rewired, and every deferral logged for downstream phases. Read it before starting Phase 3.

## Final state on `v3-clean`

- `git log v3-clean --oneline` (top of history after merge):
  - `21c142c` Merge pull request #56 from Skitza-G-R/phase-2-shells
  - `df1d683` chore(ui): phase 2 — sync palette + cheatsheet + shortcut handler
  - `88fd3af` chore(ui): phase 2 — shells + nav
  - `ee5efc2` docs(ui): phase 1 final state — merged into v3-clean
- **Pre-merge CI on PR #56:** `test` workflow ✅ SUCCESS, `Vercel Preview Comments` ✅ SUCCESS, `mergeStateStatus: CLEAN`.
- **Post-merge local re-verify on `v3-clean` (2026-05-05 21:17 UTC):**
  - `pnpm typecheck` ✅ both `packages/db` and `apps/web` clean
  - `pnpm -F web test` ✅ 986 passed / 4 skipped (matches Phase 1 baseline exactly)
  - `pnpm lint` ✅ apps/web ESLint clean
- **F4 stash restoration:** `git stash pop` applied cleanly with no conflicts. The pre-Phase-2 WIP edit on `apps/web/src/app/(producer)/dashboard/clients-projects/[id]/page.tsx` (F4 deep-link version param) is back in the working tree as uncommitted changes — Gili continues that work in a separate flow. Phase 2's commit did not touch that file, and the stash drop confirmed `Dropped refs/stash@{0} (4052b181d92aaa140f190b61ab57629d8b6503e0)`.
- **Branch hygiene:** `phase-2-shells` deleted from `origin` (`git push origin --delete phase-2-shells` ✅) and from local (`git branch -D phase-2-shells` ✅). `git branch -a` confirms no `phase-2*` references remain.
- **Smoke test (curl, dev server, 2026-05-05 20:21 UTC, pre-merge — re-runnable):**
  - `/` → 200 ✅
  - `/sign-in` → 200 ✅
  - `/dashboard`, `/dashboard/clients-projects`, `/dashboard/music`, `/dashboard/calendar`, `/dashboard/profile`, `/dashboard/settings` — all → **307** to `/sign-in` (Clerk auth gate; layouts compile, no 500s)
  - `/artist`, `/artist/music`, `/artist/book`, `/artist/store`, `/artist/settings` — all → **307** to `/sign-in` (same)
  - `/join/test` → 404 (slug doesn't exist; expected)
- **Visual sign-in screenshots:** Manual visual QA on the Vercel preview at <https://skitza-v2-web-git-phase-2-shells-gili-asrafs-projects.vercel.app> (URL retired with the branch; same artefacts now serve from the v3-clean production deploy). Producer chrome confirmed by Gili in his real browser before merge. Artist chrome verification deferred — the producer/artist signup distinction needs an existing producer slug to attach an artist via `/join/<slug>`, and Phase 2 doesn't seed one. Phase 3 will exercise the artist surface end-to-end with real test data.

---

## Inputs

The locked Phase 2 source — same `~/Downloads/skitza (1)/` directory Phase 1 used (Gili re-mounted from `/Volumes/KINGSTON/Downloads/skitza (1)/` for this session):

- `notes/skitza-context.txt` — product briefing + locked palette/typography/motion (no changes from Phase 1).
- `notes/design-system.md` — token name + value spec (no changes).
- `shell.jsx` — universal shell scaffolding (Sidebar 232/64, MobileTopBar, MobileBottomNav, FloatingPlayer + MobileFloatingPlayer).
- `shell.producer.jsx` — producer mobile chrome (`PROD_TABS`, `ProducerBottomNav` with badges, `ProducerFloatingPlayer`).
- `shell.artist.jsx` — artist mobile chrome (`ShellProvider`, `TopBar` warm, `BottomNav` dark, `FloatingPlayer`).
- `shell.artist-desktop.jsx` — artist desktop chrome (`DesktopSidebar` 248px, `DesktopHeader`, `DIcon` extras).
- `nav.jsx` — Breadcrumbs + BackButton + CommandPalette + ShortcutsHelp.

Quoted target ([notes/skitza-context.txt:1305](../../notes/skitza-context.txt:1305)): *"Keep the sidebar dark (#111009) and the main area warm off-white (#F2EDE6)."*

---

## Decisions

### 1. Open questions Raz answered before any code was written

Six questions came back to Raz before the first line of code; the answers shaped the implementation:

| # | Question | Decision |
|---|---|---|
| 1 | Mobile/desktop breakpoint | `lg:` (≥1024px = desktop). iPads stay on mobile UI. |
| 2 | `shell.jsx` desktop sidebar vs `shell.producer.jsx` mobile chrome | **Both** ship — Raz approved mobile producer for v1 (overrides CLAUDE.md's "desktop only for producer" line). |
| 3 | Insights nav item | Drop. `/dashboard/insights` doesn't exist → would 404. |
| 4 | CommandPalette + Breadcrumbs + BackButton | CommandPalette **deferred** to Phase 4 (needs real data); Breadcrumbs + BackButton ship now. |
| 5 | FloatingPlayer | Reserve a slot in the layout; Phase 4 audio-system rebuild drops in here. |
| 6 | Avatar widget | Use Clerk `<UserButton>` with `appearance` prop. Don't roll a custom dropdown. |

### 2. Why old chrome files became thin re-exports instead of being deleted

The dashboard architecture test ([`apps/web/src/app/(producer)/dashboard/__tests__/layout-architecture.test.ts`](../../apps/web/src/app/(producer)/dashboard/__tests__/layout-architecture.test.ts)) pins two source-level invariants:

1. `dashboard/layout.tsx` imports `<AppShell>` from `~/components/shell/app-shell`.
2. No `dashboard/**/page.tsx` imports `AppShell`.

Plus the sidebar tests ([`apps/web/src/components/shell/__tests__/sidebar.test.tsx`](../../apps/web/src/components/shell/__tests__/sidebar.test.tsx) and [`sidebar-share-chip.test.tsx`](../../apps/web/src/components/shell/__tests__/sidebar-share-chip.test.tsx)) read source from `~/components/shell/sidebar.tsx`.

Renaming files would have rippled into both tests and the architecture invariant. The cleaner path: the chrome **implementation** moved to `~/components/nav/`, and the legacy `shell/sidebar.tsx` file became a one-line re-export shim:

```ts
// apps/web/src/components/shell/sidebar.tsx
export {
  NAV_ITEMS,
  ProducerSidebar as Sidebar,
} from "~/components/nav/producer-sidebar";
```

The `app-shell.tsx` host kept its export name + import path so the architecture test stays green; only its body was rewritten.

`mobile-bottom-nav.tsx` (producer) and `bottom-nav.tsx` (artist) had no other importers besides their old hosts (which are now rewired to the new `~/components/nav/` paths) and no pinned tests, so both files were **deleted** outright.

### 3. Internal `ActiveKey` IDs preserved; labels + shortcuts updated

`getActiveKey(pathname)` in [`~/lib/dashboard/active-key.ts`](../../apps/web/src/lib/dashboard/active-key.ts) returns one of `today | clients-projects | music | calendar | profile | setup`. Those strings are **internal IDs** — they don't appear in the UI. The locked design changes:

| Internal `id` | Old label | New label | Old shortcut | New shortcut | Route |
|---|---|---|---|---|---|
| `today` | Today | **Overview** | G T | **G H** | /dashboard |
| `clients-projects` | Clients & Projects | Clients & Projects | G P | G P | /dashboard/clients-projects |
| `music` | Music | Music | G M | G M | /dashboard/music |
| `calendar` | Calendar | Calendar | G C | G C | /dashboard/calendar |
| `profile` | Profile | **Store** | G F | **G S** | /dashboard/profile |
| `setup` | Setup | **Settings** | G S | **G T** | /dashboard/settings |

(IDs and routes — frozen. Only the labels + shortcuts surface the new design, matching the locked `notes/nav.jsx` `ShortcutsHelp` cheat sheet.)

#### 3a. Follow-up commit (2026-05-05) — keypress handler + palette + cheatsheet caught up

The sidebar `NAV_ITEMS` shipped in the main commit pinned new labels + shortcut hints (`G H` / `G S` / `G T` etc.), but three downstream surfaces were still on the pre-Phase-2 mapping when Gili eyeballed the running app:

| Surface | File | What was stale |
|---|---|---|
| **Keypress handler** | [`apps/web/src/lib/keyboard/use-shortcuts.ts`](../../apps/web/src/lib/keyboard/use-shortcuts.ts) | `G_LEADER_ROUTES` still mapped `t` → /dashboard, `s` → /dashboard/settings, with `f` for /dashboard/profile. So pressing G T actually went to Today (Overview) — but the sidebar advertises G T = Settings. |
| **Command palette** | [`apps/web/src/components/shell/command-palette.tsx`](../../apps/web/src/components/shell/command-palette.tsx) | "Go to Today" + "Go to Setup" labels with old G T / G S shortcuts; Calendar + Store entries missing entirely (palette was last touched when the producer surface had 4 routes). |
| **Cheatsheet** | [`apps/web/src/components/shell/shortcut-cheatsheet.tsx`](../../apps/web/src/components/shell/shortcut-cheatsheet.tsx) | Same 4-row strip with old labels + shortcuts. |

Follow-up remap (one consistent mapping across every surface — keypress handler, sidebar hint, palette, cheatsheet):

| Letter | Internal `id` | Visible label | Route |
|---|---|---|---|
| `h` *(new)* | `today` | Overview | /dashboard |
| `p` | `clients-projects` | Clients & Projects | /dashboard/clients-projects |
| `m` | `music` | Music | /dashboard/music |
| `c` | `calendar` | Calendar | /dashboard/calendar |
| `s` *(reflowed)* | `profile` | Store | /dashboard/profile |
| `t` *(reflowed)* | `setup` | Settings | /dashboard/settings |
| ~~`f`~~ | ~~Profile~~ | (removed; route reached via `s`) | — |

Pinned by [`apps/web/src/lib/keyboard/use-shortcuts.test.ts`](../../apps/web/src/lib/keyboard/use-shortcuts.test.ts) — keys are `["c", "h", "m", "p", "s", "t"]` and each route is asserted explicitly. If a future remap drifts again, the test fails before any visual QA.

i18n updated:
- [`apps/web/messages/en.json`](../../apps/web/messages/en.json) → new English labels.
- [`apps/web/messages/he.json`](../../apps/web/messages/he.json) → new Hebrew labels (סקירה, חנות, הגדרות).
- `ar.json` is `{}` and not yet wired (per CLAUDE.md "English only for v1") — left untouched.

### 4. Tokens: only one new alias added

The shells reference `rgb(var(--fg-onsidebar))` for "default text on dark sidebar" and `rgb(var(--fg-onsidebar) / 0.55)` for the muted variant. Globally that's `--fg-inverse` (warm cream `#F2EDE6` on the warm-canvas + dark-sidebar inverse pair). Phase 2 adds **one** new line to [`apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css):

```css
--fg-onsidebar: var(--fg-inverse);
```

The alias keeps the chrome JSX semantically readable (`fg-default` = "on warm canvas"; `fg-onsidebar` = "on dark sidebar") without introducing a new colour. Every other token the shells reference (`--bg-sidebar`, `--brand-primary`, `--bg-background`, `--bg-elevated`, `--border-subtle`, `--border-sidebar`, `--fg-default`, `--fg-muted`, `--fg-success`, `--shadow-lg`, `--radius-lg`, `--font-syne/outfit/mono`, plus the locked motion classes `sk-press` / `sk-row` / `sk-pop` / `sk-cta-shine` / `sk-page-enter`) was already minted by Phase 1.

### 5. Existing widgets stay mounted; visual mismatch is expected

The producer sidebar bottom block re-mounts the existing widget cluster: `<SidebarShareChip>`, `<ThemeToggle>`, `<NotificationBell>`, `<LanguageSwitcher>`, and the Clerk `<UserButton>`. They were styled for the prior light-surface sidebar — some look subtly off on the dark `--bg-sidebar` rail (a few text colours read at lower contrast than ideal). This is **deliberate and expected** per Phase 2's rule: chrome shells get replaced, but the widgets they host don't get redesigned. Phase 3 redesigns each widget to match the dark surround.

The same rule applies to:
- `PersistentPlayer` (producer) — light Spotify-style dock; renders below the dark sidebar.
- `PersistentMiniPlayer` (artist) — already dark, mostly fine.
- `CommandPaletteTrigger`, `ShortcutsBridge`, `CoachmarkTour` — invisible until triggered; left mounted so producers retain ⌘K, keyboard shortcuts, and the first-run guided tour.

### 6. Architecture invariants kept; one test path updated

- **Architecture test** ([`layout-architecture.test.ts`](../../apps/web/src/app/(producer)/dashboard/__tests__/layout-architecture.test.ts)): unchanged. `dashboard/layout.tsx` still imports `<AppShell>` from `~/components/shell/app-shell`; no page imports `AppShell`. Verified green.
- **Sidebar NAV_ITEMS test** ([`sidebar.test.tsx`](../../apps/web/src/components/shell/__tests__/sidebar.test.tsx)): updated label assertions (`Overview`/`Store`/`Settings`) and shortcut assertions (`G H`/`G S`/`G T`) to match the locked design. ID + route assertions unchanged.
- **Sidebar share chip integration test** ([`sidebar-share-chip.test.tsx`](../../apps/web/src/components/shell/__tests__/sidebar-share-chip.test.tsx)): `SIDEBAR_PATH` now points to `~/components/nav/producer-sidebar.tsx` (where the chip mount actually lives after Phase 2) instead of the legacy `shell/sidebar.tsx` re-export shim. The grep regex was updated from a relative `./sidebar-share-chip` import expectation to the path-aliased `~/components/shell/sidebar-share-chip` form the new component uses.

---

## Files added (Phase 2 scope)

All under `apps/web/src/components/nav/`:

| File | Purpose |
|---|---|
| `wordmark.tsx` | "Skitza." brand glyph with the amber period interaction. `inverse` flips text to `--fg-onsidebar`. |
| `icons.tsx` | Inline-SVG icon set covering every glyph the chrome uses (`home`, `users`, `music`, `calendar`, `store`, `settings`, `bell`, `search`, `x`, `chevron-up/down/left`, `arrow-left`, `plus`, `tag`, `book`). No `lucide-react` dep added — same discipline as Phase 1 Dialog. |
| `back-button.tsx` | Chunky pill BackButton with Esc-key handler + Esc-hint kbd, ports `notes/nav.jsx`. Phase 2 doesn't yet mount it on any surface (page-level concern); ready for Phase 3 Project Room + L3 song page. |
| `producer-sidebar.tsx` | New dark left rail, 232/64 collapsible. Hosts `NAV_ITEMS`, the bottom widgets cluster, and Clerk `<UserButton>`. Reads `getActiveKey(pathname)` for active state. Listens for `skitza:toggle-sidebar` (the `[` shortcut). |
| `producer-bottom-nav.tsx` | New dark mobile bottom bar, 5 tabs (no centre FAB), amber active. Mirrors the artist bottom bar grammar. |
| `artist-mobile-top-bar.tsx` | Warm-canvas top bar with `<Wordmark>` + `<StudioSwitcher>` + Clerk `<UserButton>`. |
| `artist-bottom-nav.tsx` | Dark 5-tab bottom bar, replaces emoji-icon predecessor. |
| `artist-desktop-sidebar.tsx` | Net-new 248px dark left rail for the artist desktop surface. Hosts the `<StudioSwitcher>` for multi-producer artists + 5 nav items + `<UserButton>`. |

## Files modified (Phase 2 scope)

| File | Change |
|---|---|
| `apps/web/src/app/globals.css` | +7 lines — added `--fg-onsidebar: var(--fg-inverse);` alias. |
| `apps/web/messages/en.json` | Sidebar labels: Today→Overview, Profile→Store, Setup→Settings. |
| `apps/web/messages/he.json` | Sidebar labels: היום→סקירה, פרופיל→חנות. (`hagdarot` already meant Settings.) |
| `apps/web/src/components/shell/app-shell.tsx` | Rewired body to host `<ProducerSidebar>` (lg+) + `<ProducerBottomNav>` (<lg). Same export name + path so architecture test stays pinned. PersistentPlayer + ShortcutsBridge + CoachmarkTour + CommandPaletteTrigger preserved. |
| `apps/web/src/components/artist/artist-app-shell.tsx` | Rewired to mobile/desktop responsive: `<ArtistDesktopSidebar>` (lg+) + `<ArtistMobileTopBar>` + `<ArtistBottomNav>` (<lg). Audio provider + mini-player preserved. |
| `apps/web/src/components/shell/sidebar.tsx` | Rewritten as 5-line re-export shim — `NAV_ITEMS` and `Sidebar` (alias for `ProducerSidebar`) now live in `nav/producer-sidebar.tsx`. |
| `apps/web/src/components/shell/__tests__/sidebar.test.tsx` | Label + shortcut assertions updated to new design. |
| `apps/web/src/components/shell/__tests__/sidebar-share-chip.test.tsx` | `SIDEBAR_PATH` repointed to `nav/producer-sidebar.tsx`; import-path regex relaxed to allow path-alias form. |

## Files deleted (Phase 2 scope)

| File | Replaced by |
|---|---|
| `apps/web/src/components/shell/mobile-bottom-nav.tsx` | `apps/web/src/components/nav/producer-bottom-nav.tsx` |
| `apps/web/src/components/artist/bottom-nav.tsx` | `apps/web/src/components/nav/artist-bottom-nav.tsx` |

Both files had no remaining importers after the new chrome was wired in, and no test pinned their existence.

---

## Primitives — what was added, what was deferred

Per the Phase 2 brief, new primitives are added **only when the shells actually need them**, with the same discipline as the Phase 1 Dialog precedent.

**Added in Phase 2:** none from the deferred list. The shells the brief specified (`shell.jsx`, `shell.producer.jsx`, `shell.artist.jsx`, `shell.artist-desktop.jsx`, `nav.jsx`) didn't actually require Sheet, Tooltip, or Dropdown Menu — `title="..."` (browser default tooltip) covered the collapsed-rail icon hint, the user-menu dropdown is owned by Clerk's `<UserButton>` (with `appearance` overrides to fit the new tokens), and the locked design has no mobile drawer pattern (the artist + producer mobile chrome is top bar + bottom nav, not a side-anchored sheet).

**Still deferred** (Phase 1 list, unchanged):
- **Sheet** — first need: artist booking flow + store filters (Phase 4-5).
- **Popover** — first need: producer calendar slot editor + chip-bar filter dropdowns (Phase 3).
- **Tooltip** — first need: financial figures, status pills, autopilot rules (Phase 3+).
- **Dropdown Menu** — first need: producer kebab menus on track rows + project tiles (Phase 3).
- **Tabs** — first need: when 4+ existing per-screen tabs settle on the same shape (Phase 3-4).
- **Accordion** — first need: FAQ block on /join/[slug] (Phase 5 polish).
- **Select (Radix)** — first need: timezone picker / large filterable lists.
- **Command palette wrapper** — first need: when the `cmdk` palette gets data sources beyond the prototype trigger.

---

## FloatingPlayer slot — wiring contract for Phase 4

The producer `<AppShell>` mounts `<PersistentPlayer />` directly inside its outer flex container, between the bottom nav and the global widgets. The artist `<ArtistAppShell>` mounts `<PersistentMiniPlayer />` in the same conceptual position. Both are existing, working audio infrastructure communicating via the `skitza:player:*` window CustomEvent bus (see `apps/web/src/components/audio/persistent-player.tsx` lines 23-43 for the bus contract).

**Phase 4 swap-in plan:**
- Build the new dark `FloatingPlayer` per `notes/shell.jsx` lines 241-315 (desktop variant) + 317-342 (mobile variant) using locked tokens.
- Replace the existing `<PersistentPlayer />` mount in [`apps/web/src/components/shell/app-shell.tsx`](../../apps/web/src/components/shell/app-shell.tsx) and `<PersistentMiniPlayer />` in [`apps/web/src/components/artist/artist-app-shell.tsx`](../../apps/web/src/components/artist/artist-app-shell.tsx) with the new component.
- Same custom-event bus → no other call-site changes needed; pages that dispatch `skitza:player:set` keep working.

The mount points are exactly where the audio-system rebuild expects them. No layout edits required for the swap.

---

## Other deferred items for Phase 3+

| Item | Why deferred | First-likely phase |
|---|---|---|
| Pinned-projects panel in artist desktop sidebar | Needs project data (and a "pin" boolean on artist projects, which doesn't exist in v1 schema) | Phase 4-5 |
| "Producer dashboard" backlink in artist `<UserButton>` menu (dual-role users) | Needs the new chrome's `<UserButton>` appearance API redesign to fit the dark surround. Existing menu still works — Clerk owns the dropdown. | Phase 3 |
| `<DesktopHeader>` (artist desktop page-title strip) | Page-level concern; the layout shell can't set the title — pages render their own headers. | Phase 3-4 (per page) |
| Greeting block ("Welcome back, [name]") on artist mobile top bar | Needs a tRPC fetch for display name; leaks into page territory. Phase 2 ships StudioSwitcher + UserButton instead. | Phase 3 |
| CommandPalette redesign | Per Raz Q4 — needs real data (projects/songs/clients) which doesn't land until Phase 4. Existing trigger remains mounted + functional. | Phase 4 |
| BackButton mount points | Pure layout primitive; the deep dashboard pages that need it are Phase 3+. The component is built and ready. | Phase 3 |
| Breadcrumbs use in new chrome | The existing [`apps/web/src/components/ui/breadcrumbs.tsx`](../../apps/web/src/components/ui/breadcrumbs.tsx) primitive (Phase 1 era) is unchanged and still used by deep pages. Phase 2's new shells don't render breadcrumbs at the layout level. | Phase 3 |
| Visual redesign of `ThemeToggle`, `NotificationBell`, `LanguageSwitcher`, `SidebarShareChip` | Functionally preserved, visually mismatched on dark rail. | Phase 3 |
| Fluid switching between PersistentPlayer (legacy) and FloatingPlayer (new) | Replaced wholesale in Phase 4. No bridge needed. | Phase 4 |

---

## Out-of-scope discipline (verified)

The Phase 2 brief was explicit: page contents stay untouched, no tRPC/DB/auth edits, no design-token redefinition. `git diff --name-only v3-clean..HEAD` confirms:

- **Zero changes** under `apps/web/src/app/(producer)/dashboard/**/page.tsx`.
- **Zero changes** under `apps/web/src/app/(artist)/artist/**/page.tsx`.
- **Zero changes** under `apps/web/src/server/`.
- **Zero changes** under `packages/db/`.
- **One token addition** (`--fg-onsidebar` alias) — no existing token redefined.

The only "layout" file changed is `(producer)/dashboard/layout.tsx`'s sibling `~/components/shell/app-shell.tsx`, which the architecture test pins as the canonical shell host (per Phase 1 + earlier audit decisions). Producer + artist top-level layouts (`(producer)/layout.tsx`, `(artist)/artist/layout.tsx`) were not touched.

The pre-existing F4 deep-link work in `clients-projects/[id]/page.tsx` (modified before Phase 2 started) was **stashed** (`git stash@{0}`) on `v3-clean` so it stays out of this PR.

---

## Verification (re-checked 2026-05-05 20:21 UTC on `phase-2-shells`)

```
$ pnpm typecheck
packages/db typecheck: Done
apps/web typecheck: Done

$ pnpm -F web test
Test Files  93 passed | 1 skipped (94)
Tests       986 passed | 4 skipped (990)

$ pnpm lint
apps/web lint: Done

$ for path in / /sign-in /dashboard /dashboard/clients-projects /dashboard/music /dashboard/calendar /dashboard/profile /dashboard/settings /artist /artist/music /artist/book /artist/store /artist/settings /join/test; do
    /usr/bin/curl -sIo /dev/null -w "%{http_code} $path\n" "http://localhost:3000$path"
  done
200 /
200 /sign-in
307 /dashboard
307 /dashboard/clients-projects
307 /dashboard/music
307 /dashboard/calendar
307 /dashboard/profile
307 /dashboard/settings
307 /artist
307 /artist/music
307 /artist/book
307 /artist/store
307 /artist/settings
404 /join/test          # slug doesn't exist; expected
```

No 500s, no compile errors in dev-server logs.

---

## Manual verification (Gili)

Sign in as a producer at `http://localhost:3000/sign-in`, then visually QA:

1. **Producer desktop** (≥1024px) — `/dashboard`. Expect: dark left rail (232px), `Skitza.` wordmark with amber period at top, 6 nav items (Overview / Clients & Projects / Music / Calendar / Store / Settings), amber active-bar indicator, bottom block with widgets cluster + UserButton avatar. Page contents: visually mismatched (Phase 3 territory).
2. **Producer mobile** (<1024px, e.g. iPad portrait at 820×1180 or DevTools 375×812) — same `/dashboard`. Expect: no left rail, dark 5-tab bottom nav (Home / Clients / Library / Calendar / Store), amber active colour with top brand-bar indicator. Sidebar widgets disappear on mobile (no top bar to host them — pre-existing behaviour, intentional).
3. **Artist mobile** (<1024px) — `/artist`. Expect: warm top bar with Skitza wordmark + StudioSwitcher + UserButton, dark 5-tab bottom nav (Home / Music / Book / Store / Settings).
4. **Artist desktop** (≥1024px) — `/artist`. Expect: dark left rail (248px) with wordmark + StudioSwitcher + 5 nav items + UserButton account chip; main content column widens.

Smoke navigate every nav item on each surface — every link should resolve to a page that loads (visual mismatch is expected; crashes are not).

---

## Phase 3 starting points

When Phase 3 begins migrating screens to the new chrome:

1. Pick one screen at a time from the brief Raz writes — don't touch adjacent files.
2. Use the existing `~/components/ui/breadcrumbs.tsx` primitive for inline breadcrumbs at the top of deep pages.
3. Use `~/components/nav/back-button.tsx` for the page-level back button on drill-down pages (project room, L3 song page).
4. Stop importing from `~/components/shell/sidebar` for new code — go to `~/components/nav/producer-sidebar` directly. The shim stays only for legacy callers.
5. Replace inline `bg-[rgb(var(--bg-base))]` with `bg-[rgb(var(--bg-background))]` in any newly-touched page (canonical name; old aliases still work).
6. When the redesigned `ThemeToggle`/`NotificationBell`/`LanguageSwitcher` land, drop them into the producer sidebar bottom block — same mount point, new visual.
7. When the new `FloatingPlayer` lands, replace `<PersistentPlayer />` in `app-shell.tsx` and `<PersistentMiniPlayer />` in `artist-app-shell.tsx` with the new component. Same custom-event bus, same mount sites.
