# Story 03 — Sub-tab perf refactor (4 tabs, no remount, shallow routing)

**Epic:** Project Room redesign 2026-04-26
**Architecture ref:** [`docs/plans/active/2026-04-26-project-room-redesign-architecture.md` § 7 Performance fix](../active/2026-04-26-project-room-redesign-architecture.md)
**Depends on:** S02 (per-tab tRPC procedures wired client-side)
**Blocks:** none — independently mergeable; S04 + S05 + S06 each render their own tab content but don't change tab-switch behavior
**Subagent:** `skitza-tdd-implementer`

## Goal

Fix the 5-second sub-tab switch (current behavior). Make tab switching client-side, instant (< 150ms perceived), with no remount and no full refetch. Update the tab list to 4 tabs (Dashboard / Music / Sessions / Money) — Notes is gone (PRD §4.2). This is the user-visible perf win that ships independently of the Dashboard / Music UI redesigns.

## User story

As a producer or artist, when I switch between Project Room sub-tabs (Dashboard ↔ Music ↔ Sessions ↔ Money), I want it to be instant — same speed as switching tabs in a desktop app — instead of waiting 5 seconds for a server round-trip and a remount.

## Acceptance criteria

- [ ] [`apps/web/src/components/dashboard/project/project-sub-tab-shared.ts`](../../apps/web/src/components/dashboard/project/project-sub-tab-shared.ts) — `ProjectSubTab` union changes from `'music' | 'sessions' | 'money' | 'notes'` to `'dashboard' | 'music' | 'sessions' | 'money'`. Default in `resolveSubTab` is `'dashboard'`.
- [ ] **CRITICAL — file must NOT have `"use client"` directive.** Per CLAUDE.md mistake log 2026-04-23, this module is imported by both the server page and the client tabs. The pinning test at [`apps/web/src/components/dashboard/project/__tests__/project-sub-tab-shared.test.ts`](../../apps/web/src/components/dashboard/project/__tests__/project-sub-tab-shared.test.ts) asserts the first non-empty line of the source file isn't `"use client"`.
- [ ] [`apps/web/src/components/dashboard/project/project-sub-tabs.tsx`](../../apps/web/src/components/dashboard/project/project-sub-tabs.tsx) is rewritten:
  - Tab strip uses `<button>` (not `<Link>`) with `onClick` → `router.replace(url, { scroll: false })` for **shallow** URL update. No Next.js server round-trip on tab change.
  - All 4 panels are mounted at all times. Inactive panels are hidden via CSS `display: none` (not `visibility: hidden`, not unmounted). Audio playback / scroll position / in-progress uploads survive tab change.
  - **No `key={activeTab}` on the panel div.** This is the React-remount kill.
  - Reveal-up animation fires once per panel on first paint, not on tab change. Use a `data-mounted` attribute or `useState` flag.
  - ARIA stays correct: `id="tab-<key>"` + `aria-controls="panel-<key>"` on the button; `id="panel-<key>"` + `aria-labelledby="tab-<key>"` on the panel; both IDs match. `aria-current="page"` on the active tab button (NOT `aria-pressed` — that's for toggles, per CLAUDE.md ARIA conventions).
- [ ] Each panel runs its own `trpc.projectRoom.<tab>.useQuery({ projectId })` with `staleTime: 30_000`. On first page mount, all 4 queries are kicked off in parallel via `useQueries` (or equivalent); the active tab's query is prioritized so it resolves first.
- [ ] [`apps/web/src/app/(app)/dashboard/projects/[id]/page.tsx`](../../apps/web/src/app/(app)/dashboard/projects/[id]/page.tsx) trims server fetch to `projectRoom.shell` only — minimum data to render the header strip + tab bar. Per-tab data fetched client-side.
- [ ] [`apps/web/src/components/dashboard/project/sub-tabs/notes-sub-tab.tsx`](../../apps/web/src/components/dashboard/project/sub-tabs/notes-sub-tab.tsx) is **deleted**. Confirm via `grep -rn "notes-sub-tab\|NotesSubTab" apps/web/src` returns no callers.
- [ ] **Dev-only perf probe** in `project-sub-tabs.tsx`:
  ```tsx
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const t0 = performance.now();
    requestAnimationFrame(() => {
      const dt = performance.now() - t0;
      if (dt > 150) console.warn(`[perf] tab switch ${activeTab} took ${dt}ms`);
    });
  }, [activeTab]);
  ```
- [ ] CSS rule for hiding inactive panels lives in `apps/web/src/app/globals.css` (token-driven, no hex):
  ```css
  [role="tabpanel"][data-active="false"] { display: none; }
  ```
- [ ] **Audio playback continuity** — manually verified: play a track from Music, switch to Dashboard, switch back. Audio is at the same time position and still playing. (Acceptance criterion in §10.4 of architecture doc.)
- [ ] All 4 sub-tabs render placeholders for the new content surfaces (the actual UI ships in S04/S05/S06 — this story is plumbing only).
- [ ] Existing test [`apps/web/src/components/dashboard/project/__tests__/project-sub-tab-shared.test.ts`](../../apps/web/src/components/dashboard/project/__tests__/project-sub-tab-shared.test.ts) updated for the new tab union.
- [ ] New test `apps/web/src/components/dashboard/project/__tests__/project-sub-tabs.test.tsx`:
  - Renders 4 tabs with correct ARIA wiring.
  - Click "Music" → URL updates to `?tab=music` without page navigation (mock `router.replace`).
  - Inactive panels are present in the DOM with `data-active="false"`.
  - Active panel has `data-active="true"`.
  - Tab switch within 150ms (use a fake timer or assert via `data-active` swap synchronously after click).
- [ ] `/skitza-verify` passes.

## Technical context

### Files to touch

- [`apps/web/src/components/dashboard/project/project-sub-tab-shared.ts`](../../apps/web/src/components/dashboard/project/project-sub-tab-shared.ts) — type union + resolver
- [`apps/web/src/components/dashboard/project/project-sub-tabs.tsx`](../../apps/web/src/components/dashboard/project/project-sub-tabs.tsx) — full rewrite
- [`apps/web/src/components/dashboard/project/sub-tabs/notes-sub-tab.tsx`](../../apps/web/src/components/dashboard/project/sub-tabs/notes-sub-tab.tsx) — delete
- [`apps/web/src/app/(app)/dashboard/projects/[id]/page.tsx`](../../apps/web/src/app/(app)/dashboard/projects/[id]/page.tsx) — trim server fetch
- [`apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css) — `[role="tabpanel"][data-active="false"]` rule

### Why `display: none` (not `visibility: hidden`)

`display: none` removes the panel from layout. `visibility: hidden` keeps the layout space but hides the content. We want to keep audio elements alive AND not pay the layout cost — so `display: none` is correct. **Edge case**: some Web Audio APIs pause on `display: none`. If the audio-continuity acceptance fails, fall back to `visibility: hidden + position: absolute + height: 0 + overflow: hidden` (uglier but reliably keeps audio playing). Document the fallback choice in code comments.

### Shallow routing in App Router

Next.js App Router doesn't have a documented shallow-routing API like Pages Router did. The pattern is:

```tsx
import { useRouter } from "next/navigation";
const router = useRouter();
// router.replace(href, { scroll: false }) — does NOT re-execute the
// server page if only search params change for a non-dynamic route.
// Verify by adding a console.log to page.tsx and ensuring it doesn't
// fire on tab change.
```

If a server round-trip still fires, switch to `window.history.replaceState` directly and read `useSearchParams()` for the active tab. Not as nice but bulletproof.

### Mistake-log invariant test (already exists)

[`apps/web/src/components/dashboard/project/__tests__/project-sub-tab-shared.test.ts`](../../apps/web/src/components/dashboard/project/__tests__/project-sub-tab-shared.test.ts) already pins the "no use client at top of project-sub-tab-shared.ts" invariant per the 2026-04-23 (post-observability) mistake log. Do NOT remove this test. Update its expected union values to the new 4-tab list.

## TDD steps

1. **RED** — update the existing pinning test for `project-sub-tab-shared.ts`. Now expects union `'dashboard' | 'music' | 'sessions' | 'money'`. Run — fails.
2. **GREEN** — update the union + `isProjectSubTabId` + `resolveSubTab` default. Tests pass.
3. **RED** — write `project-sub-tabs.test.tsx`. Asserts: 4 tabs render with `aria-controls` + `aria-labelledby` matching panel IDs; click "Music" calls `router.replace('/dashboard/projects/X?tab=music', { scroll: false })`; inactive panels render `data-active="false"`; clicking through Music → Dashboard → Music shows the Music panel content un-remounted (use a `key={Math.random()}`-style proof: render a child with `useState(() => Math.random())`, snapshot the value, switch tab, switch back, assert same value).
4. **GREEN** — rewrite `project-sub-tabs.tsx`. All 4 panels mounted, CSS-hidden, shallow-route on click, data-active toggle. Test goes green.
5. **RED + GREEN** — perf-probe test. Mock `performance.now`, snap two values, assert the diff is sub-150ms. (Or assert via the warning side-effect not firing.)
6. **RED + GREEN** — page.tsx trim. The page now only fetches `projectRoom.shell`. Existing page tests in [`apps/web/src/app/(app)/dashboard/projects/[id]/__tests__/`](../../apps/web/src/app/(app)/dashboard/projects/[id]/__tests__/) (if any) need updating; add a new test asserting the page renders with only shell data.
7. Delete `notes-sub-tab.tsx`. Grep for `NotesSubTab` / `notes-sub-tab` — should be zero callers. Run typecheck — should be clean.
8. **Manual smoke test** — start `pnpm dev`, navigate to a project, switch tabs 10 times in a row. The dev-only perf probe should never warn. Audio plays in Music, survives switch to Dashboard, still plays on switch back.
9. `/skitza-verify` passes.

## Test file paths

- `apps/web/src/components/dashboard/project/__tests__/project-sub-tab-shared.test.ts` — modify (update expected union)
- `apps/web/src/components/dashboard/project/__tests__/project-sub-tabs.test.tsx` — new (or extend existing)

## Definition of done

- [ ] Tab switch < 150ms perceived (manual verification + dev-probe never warns)
- [ ] Audio playback survives tab switch (manual verification)
- [ ] All 4 panels DOM-present (data-active toggle confirmed in DevTools)
- [ ] Notes references all removed (grep clean)
- [ ] `/skitza-verify` green

## Commit message

```
refactor(project-room): client-side sub-tab switching, no remount

Fixes the 5-second tab-switch latency reported by the user. The fix
stacks three changes:

(a) Tab strip uses <button> + router.replace(url, { scroll: false })
instead of <Link> — shallow URL update, no Next.js server round-trip.

(b) All 4 panels are mounted at all times. Inactive panels hidden via
CSS (display: none on [role="tabpanel"][data-active="false"]). The
key={activeTab} that was forcing remount on every switch is gone.
React state, scroll position, in-progress uploads, and audio playback
all survive tab change.

(c) Per-tab data is its own tRPC query with staleTime: 30_000. All 4
queries kicked off in parallel on first mount via useQueries; active
tab's query prioritized so it resolves first.

Tab union also flips from 4-tabs (music/sessions/money/notes) to
4-tabs (dashboard/music/sessions/money) — Notes is gone per PRD §4.2.
Default sub-tab is now 'dashboard'. The notes-sub-tab.tsx file is
deleted; no callers remain (grep clean).

Pinning test for project-sub-tab-shared.ts (no "use client" at top of
file — invariant from 2026-04-23 mistake log) is preserved and
updated for the new union.

Dev-only perf probe in project-sub-tabs.tsx warns if a tab switch
exceeds 150ms (the architecture-doc target). Useful for catching
future regressions.

Story 03 of the project-room-redesign epic. Depends on S02 (per-tab
tRPC procedures). Independently mergeable — this ships the perf win
without waiting for the new Dashboard/Music UIs (S04/S05/S06).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
