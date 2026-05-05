# Phase 1 — Design System Foundation Handoff

**Branch:** `v3-ui-design` (off `v3-clean`)
**PR:** [skitza-v2#55](https://github.com/Skitza-G-R/skitza-v2/pull/55)
**Date:** 2026-05-05
**Scope:** design tokens + primitives + toast system. **No screens migrated.**

This document records every decision made during Phase 1 so Phase 2 can pick up cleanly. Read this before starting any screen migration.

---

## Inputs

The locked design system was extracted from `~/Downloads/skitza (1)/`:

- `notes/skitza-context.txt` — product briefing + locked colour/typography/motion spec.
- `notes/design-system.md` — token-name + value spec.
- `styles.css` — reference CSS implementation.
- `primitives.jsx` — vanilla-React reference primitives (`Pill`, `StatusPill`, `Avatar`, `Card`, `PlayCircle`, `Waveform`, `EqBars`, `ProjectBadge`).

Quoted decision (skitza-context.txt:1305): *"Keep the sidebar dark (#111009) and the main area warm off-white (#F2EDE6)."*

Quoted token (design-system.md:4): *"`--brand-primary: 212 150 10` (amber #D4960A) — single accent, used sparingly."*

---

## Decisions

### 1. Backward-compat token aliasing

The locked design system uses different token names than the existing Phase D codebase:

| New canonical (design-system.md) | Existing alias (kept) |
|---|---|
| `--bg-background` | `--bg-base` |
| `--bg-elevated` | `--bg-default` |
| `--fg-default` | `--fg-primary` |
| `--brand-copper` | `--brand-accent`, `--brand-accent-soft` |
| `--brand-primary` | `--accent` |
| `--border-strong` | `--border-default` |

**Why:** existing Tailwind arbitrary-value call-sites (`bg-[rgb(var(--bg-base))]`) appear in hundreds of places. Sweeping renames would have ballooned Phase 1 outside the brief's foundation-only scope. CSS `var()` is recursive, so `rgb(var(--bg-base))` resolves through the alias to the new channel triple.

**Phase 2 implication:** screens migrating to the new system are free to use either name. A future cleanup pass can normalise to canonical names once the migration is complete.

### 2. `sk-pop` / `sk-press` naming collision

The locked spec calls the tactile press feedback `sk-pop` (scale `0.94` on active, brightness `1.05` on hover). The existing codebase already uses `.sk-pop` for popover/modal mount-entrances (~16 call-sites + `motion-primitives.test.ts` asserting it contains `@keyframes skitza-pop-in`).

**Decision:** keep `sk-pop` for mount-entry, add the new tactile feedback as `.sk-press`. Documented in `globals.css` with a code comment.

**Phase 2 implication:** continue using `.sk-press` on Buttons/chips. Don't rename to `sk-pop` — the test will fail.

### 3. Fraunces retired; Syne global

Phase D used Fraunces (variable-axis serif) as the display face. The locked spec drops Fraunces entirely and uses Syne 600/700/800 for *all* headings + the wordmark.

**Decision:** removed `Fraunces` from `apps/web/src/app/layout.tsx`. Syne 600/700/800 promoted to global `--font-syne`. `--font-display` and `--font-head` re-aliased to `--font-syne` in `globals.css`, so existing `.font-display` consumers keep rendering without per-file edits.

**Phase 2 implication:** `font-display` Tailwind utility now resolves to Syne; no rename needed at call-sites.

### 4. Toast API preserved; sonner under the hood

The previous `toast.tsx` was a hand-rolled context + queue. The locked spec doesn't change the public API — it asks for a sonner-backed implementation.

**Decision:** rewrote `apps/web/src/components/ui/toast.tsx` to re-export `useToast()` and `<ToastProvider>` with the **identical** signatures. Internally backed by `sonner@^2`. The ~30 existing call-sites (`const { toast } = useToast(); toast("Saved", "success")`) keep working unchanged.

Sonner is themed via `toastOptions.classNames` using the new tokens (`--bg-elevated`, `--border-subtle`, `--fg-default`, `--brand-primary`, `.sk-toast-in` entrance).

**Phase 2 implication:** continue calling `useToast().toast(message, variant)`. Sonner's richer features (action buttons, async loading) are available by importing `toast` directly from `"sonner"` if needed.

### 5. Dialog primitive deliberately not added

The verification asked for a Dialog screenshot. **No `dialog.tsx` exists** in `apps/web/src/components/ui/`. The codebase has 14 primitives (badge, breadcrumbs, bulk-action-bar, button, card, empty-state, input, keyboard-hint, list-search, qr-code, save-indicator, skeleton, toast, validation) — none of them a generic Dialog. Modals are inline (`add-charge-modal.tsx`, `cancel-confirm-modal.tsx`, etc.).

**Decision:** did NOT add a Dialog primitive. Phase 1 brief said "update existing primitives" — adding a new primitive is out of scope.

**Phase 2 implication:** if a Dialog primitive is needed, add it then with the locked tokens (`--bg-elevated` surface, `--border-subtle` hairline, `slide-up-modal` entrance on mobile, `sk-pop-center` on desktop).

### 6. Border alpha — channel form, not pre-baked

Phase D defined `--border-subtle: 0 0 0 / 0.08` (alpha-baked into the channel). The locked spec uses `--border-subtle: 232 225 212` (channel-only, alpha applied at consumer).

**Decision:** moved to channel-only form. Existing `bg-[rgb(var(--border-subtle)/0.5)]` call-sites still work (resolves to `rgb(232 225 212 / 0.5)`). Visual effect changes slightly — borders read warmer (cream-tinted) instead of darker (alpha-on-bg).

### 7. Radius scale 8 / 12 / 16 / 20 / 28

Phase D used 4 / 8 / 12 / 1rem / (no 2xl). The locked spec is 8 / 12 / 16 / 20 / 28. Cards now use `--radius-lg` (16px) per the design-system.md spec.

### 8. Out-of-scope discipline

The brief said: don't touch layouts, pages, tRPC, DB, auth.

**Verified:** `git diff --name-only v3-clean..HEAD` shows zero changes in `(producer)/`, `(artist)/`, `server/`, `packages/db/`. The only "layout" file changed is `apps/web/src/app/layout.tsx` — touched **only** to swap `next/font` instances (drop Fraunces, consolidate Outfit + Syne) and update Clerk appearance hex values to the locked palette. Both directly required by the brief's "Add fonts via next/font if changed" step.

---

## Files changed (Phase 1 scope: `git diff v3-clean..HEAD`)

| File | Lines changed |
|---|---|
| `apps/web/package.json` | +1 (sonner) |
| `apps/web/src/app/globals.css` | +369 / -328 |
| `apps/web/src/app/layout.tsx` | +33 / -59 |
| `apps/web/src/components/ui/badge.tsx` | +14 / -8 |
| `apps/web/src/components/ui/button.tsx` | +29 / -26 |
| `apps/web/src/components/ui/card.tsx` | +25 / -13 |
| `apps/web/src/components/ui/empty-state.tsx` | +2 / -2 |
| `apps/web/src/components/ui/input.tsx` | +12 / -11 |
| `apps/web/src/components/ui/toast.tsx` | +91 / -87 |
| `pnpm-lock.yaml` | +14 |
| `docs/qa/phase-1-design-system/*.png` | 5 screenshots |

Net: **15 files** / **+626 / -498**. Foundation-only.

---

## Verification (re-checked 2026-05-05)

- `pnpm typecheck` — ✅ both `packages/db` and `apps/web` clean.
- `pnpm -F web test` — ✅ 986 passed / 4 skipped (4 skipped are pre-existing).
- `pnpm lint` — ✅ apps/web ESLint clean.
- `motion-primitives.test.ts` — ✅ passes; all asserted primitives (`sk-lift`, `sk-pop`, `sk-pop-center`, `sk-cta-shine`, `sk-pulse-hover`, `sk-page-enter`, `sk-stagger-item`) still exist and are inside the reduce-motion gate.
- Dev server boots — ✅ `localhost:3000` responds 200; `/dashboard` returns 307 → `/sign-in` (Clerk auth gate, not a runtime crash).
- No console errors on `/sign-in` or `/`.

---

## Screenshots

Captured locally — v3-clean (port 3001) before, v3-ui-design (port 3000) after, light mode, 1280×800.

- `docs/qa/phase-1-design-system/phase-1-before-signin.png` ↔ `phase-1-after-signin.png` — `/sign-in` (Button + Card + Input)
- `docs/qa/phase-1-design-system/phase-1-before-landing.png` ↔ `phase-1-after-landing.png` — `/` landing (Button + hero typography)
- `docs/qa/phase-1-design-system/phase-1-after-landing-cards.png` — pain-card section (Card grid in dark sidebar surface)
- `docs/qa/phase-1-design-system/phase-1-after-input-zoom.png` — closer view of Card + Input + Button cluster

`/dashboard` requires Clerk auth, so `/sign-in` stands in as the proxy. The Vercel preview build for `v3-ui-design` will exercise the real `/dashboard` once a producer signs in.

---

## Phase 2 starting points

When migrating screens to the new tokens:

1. Pick one screen at a time from the brief Raz writes — don't refactor adjacent files.
2. Replace any direct hex strings with `rgb(var(--token))` — never use `--bg-base` and `--bg-background` interchangeably in the same component (pick canonical names).
3. Apply `.sk-press` to interactive chips/buttons that don't already use the Button primitive.
4. Apply `.sk-row` to list rows.
5. For cards, prefer `<Card>` from `~/components/ui/card` rather than reimplementing `bg-[rgb(var(--bg-elevated))] border border-[rgb(var(--border-subtle))] rounded-[var(--radius-lg)]` inline.
6. For status pills, prefer `<Badge variant="success|active|warning|danger|accent">` over `.pill-*` raw classes — both render the same; the JSX wrapper carries dot affordance.
7. For toasts, keep using `useToast().toast(message, variant)`. Don't import sonner directly unless you need rich features (action buttons, loading states).
