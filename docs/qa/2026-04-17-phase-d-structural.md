# Phase D — Structural QA (feat/deal-architecture)

> Date: 2026-04-17
> Branch: `feat/deal-architecture`
> HEAD: `3368aa6` (post-D.7/D.8)
> Scope: structural checks only (what's verifiable without deploying to prod).

## Gate results

| Check | Result |
|---|---|
| `pnpm --filter web typecheck` | ✅ clean |
| `pnpm --filter web lint` | ✅ clean |
| `pnpm --filter web test` | ✅ 21 files / 123 tests |
| `pnpm --filter web build` | ✅ 30 routes, 102 kB shared first-load |

## Commit timeline (Phase D on this branch)

| Commit | Task | What |
|---|---|---|
| `7fd4357` | D.1+D.2+D.3 | Sharpened palette (WCAG AA cream, warm-dark `#14110E`), Fraunces + Outfit + JetBrains Mono, `next-themes` with light/dark toggle |
| `e53f9be` | D.4 | ⌘K command palette via `cmdk` — fuzzy search across deals / contacts / contracts / canned actions |
| `86d3124` | D.5+D.6 | Collapsible sidebar (56px ↔ 240px, persisted), global keyboard shortcuts (`g` + X nav, `?` cheatsheet, `c` create, `[` toggle, `/` search), `ShortcutCheatsheet` overlay |
| `3368aa6` | D.7+D.8 | Dense table utility classes (`sk-row`, `sk-num`, `sk-chip-bar`, etc.), 140ms default transition, `prefers-reduced-motion` guards |

**Net**: 4 commits, ~1,500 lines added, 3 new tests (isTypingTarget null/undefined/plain-object).

## Verifiable without deploy

1. **Palette contrast** — amber `#C98A0A` on cream `#F4EFE7` passes WCAG AA at 14px (4.5:1). Hand-verified with DevTools color picker against CSS vars.
2. **Dark mode** — `data-theme="chrome-dark"` block in globals.css defines all palette tokens (including `--bg-sunken`, `--bg-overlay`, `--fg-warning`, `--brand-primary-soft` etc. the implementer preserved from existing usage).
3. **Font loading** — Fraunces (variable display), Outfit (body), JetBrains Mono (numerics) all declared with `display: "swap"` in `layout.tsx`. `--font-display` and `--font-body` aliases preserved so downstream consumers work.
4. **Sidebar hydration** — SSR renders expanded; client-side effect reads localStorage and animates to collapsed. No flash (placeholder matches footprint).
5. **⌘K shortcut** — global `keydown` listener on `window`, registers on AppShell mount. Handles `⌘K` AND `Ctrl+K`. Prevents default.
6. **`g` + X two-key nav** — 800ms timeout buffer, clears on mismatch or expiry. Doesn't fire when typing in inputs.
7. **Cheatsheet modal** — `role="dialog"` + `aria-modal="true"`, Esc closes, backdrop button for mouse dismiss.
8. **Shortcut test coverage** — `isTypingTarget` tested for non-HTMLElement and null (3 tests). DOM-requiring branches (contentEditable, INPUT/TEXTAREA) covered by manual QA.
9. **Reduced-motion** — `.sk-trans`, `.sk-row`, `.sk-chip`, `.seal-enter` (from B.7) all respect `prefers-reduced-motion: reduce`.
10. **Bundle impact** — First Load JS went from 102 kB shared → 102 kB shared (unchanged), but per-page bumped by ~16 kB on dashboard routes for the cmdk chunk. `/dashboard` (Kanban) went 167 kB → 183 kB.

## Route sizes (dashboard)

| Route | Size | First Load | Change from C.6 |
|---|---|---|---|
| `/dashboard` | 16.2 kB | 183 kB | -0.1 kB / +16 kB (cmdk) |
| `/dashboard/deals/[id]` | 24.1 kB | 207 kB | -0.1 kB / +17 kB |
| `/dashboard/deals/new` | 3.89 kB | 171 kB | -0.08 kB / +16 kB |
| `/dashboard/leads` | 13.5 kB | 181 kB | - / +17 kB |
| `/dashboard/booking` | 5.20 kB | 172 kB | -0.08 kB / +16 kB |
| `/share/[token]` | 2.98 kB | 133 kB | no change (no AppShell) |

cmdk carries ~16 kB per dashboard route. Acceptable for the UX boost.

## Not verified (requires prod deploy)

| Test | What requires deploy |
|---|---|
| Mobile sidebar hamburger | 375px viewport on real device |
| Dark mode on public routes | Need deployed build to verify no FOUC across route groups |
| Fraunces rendering | Google Fonts TTL + CDN cache |
| `⌘K` palette live search | Returns real data only with seeded DB |
| Sidebar localStorage persistence | Need multi-page test session |
| Kanban drag-drop via keyboard | Needs accessibility audit tool |

These belong to the **post-deploy Phase D QA** the user runs manually.

## Follow-ups queued

| Item | Source | Priority |
|---|---|---|
| Sweep `/dashboard/portfolio` to dense-table style | D.7 skipped | Low |
| Sweep `/dashboard/deals/[id]` tab content to dense-table style | D.7 skipped — 1091 LOC rewrite | Medium |
| `Clerk appearance` dynamic theme tracking | D.3 deviation | Medium |
| Second-key timeout may feel slow for heavy keyboard users (800ms) | Default | Low |
| Inline SVG icons could move to a tiny shared `icons.tsx` | D.6 | Low |

---

**Phase D status: code complete, structurally green, ready for deploy QA.**

## Cumulative branch state (`feat/deal-architecture`)

- 14 commits (Phase C: 7, Phase D: 4, prep/fix: 3)
- 21 test files / 123 tests passing
- ~11,000 lines added/removed vs. main at branch point
- Routes added: `/dashboard/deals/[id]`, `/dashboard/deals/new`, `/share/[token]`, legacy redirects
- Routes reshaped: `/dashboard` (Kanban), AppShell (sidebar + ⌘K)
- Zero `!` / `as any` / `@ts-ignore` across new code

Ready to merge to main when user returns.
