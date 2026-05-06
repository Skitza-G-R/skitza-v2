# Phase 3 — Public routes (landing + auth + /join/[slug] + legal) Handoff

**Status:** PR open, awaiting review.
**Branch:** `phase-3-public` (base: `v3-clean`).
**Approver:** Raz (technical co-founder).
**Author:** Gili (with Claude Code).
**Scope:** Replace the PR #50 verbatim-port landing with the v3 marketing surface from `~/Downloads/skitza (1)/`. Replace the `(public)/(auth)` layout with a split-screen BrandPanel + Clerk-form layout. Enhance Clerk appearance. Polish the legal pages (About replaced; Privacy/Terms cleaned up).

This document records every decision made during Phase 3 so Phase 4 (producer dashboard pages) and Phase 5 (artist platform) can pick up cleanly.

---

## Inputs

The locked v3 source — same `~/Downloads/skitza (1)/` directory Phase 1 + 2 used. New files exercised by Phase 3 (vs. Phase 1+2):

- `tabs/landing.jsx` — v3 desktop landing (8 sections + 3D product peek + WaitlistModal — modal retired per PRD §3.5).
- `tabs/landing-mobile.jsx` — v3 mobile landing (denser; same 8 sections, single column).
- `tabs/auth.jsx` — split-screen sign-in / sign-up / forgot / verify with custom 3-button social row, password strength meter, 6-digit OTP input.
- `index.html` lines 144-156 + 1894-2050 — IntersectionObserver wiring + 3D tilt + word-fade pattern.

Phase 1 + 2 inputs (already on `v3-clean`):
- `notes/skitza-context.txt` — locked palette/typography/motion (no changes).
- `notes/design-system.md` — token name + value spec.

---

## Decisions

### 1. Landing — wholesale replacement (not refactor)

The existing `apps/web/src/components/landing/landing-page.tsx` (PR #50) was a 83 KB verbatim port of the *previous* founder design. Phase 3's v3 design source is structurally different — different section IDs (`stack-replace` / `feature-grid` / `how` / `final-cta` instead of `pain` / `solution` / `compare` / `consolidation` / `download`), different copy structure, 3D product peek in hero, etc. **Phase 3 replaces the file wholesale** rather than refactoring.

The single-file shape was preserved — the PR #50 pivot from a 17-component decomposition to single-file (CLAUDE.md mistake-log 2026-04-26 (landing-restore CSS scoping)) demonstrated that animation reliability beats component reuse for marketing-only surfaces.

**Phase 4 + 5 implication:** if either build chat reuses any landing pattern (the gradient swatches, the `sk-reveal*` reveal contract, the wordmark rendering) — those are now in `globals.css` + `landing.css` and are safe to import from anywhere. Don't import from `landing-page.tsx` (the components there are private to that file).

### 2. WaitlistModal retired (PRD §3.5)

The v3 design source uses a `<WaitlistModal>` triggered by every "Get demo access" CTA — a dual-action gate that captures email + persona before passing the visitor to sign-up. **PRD §3.5 explicitly retired the waitlist** in the prior landing pass; every CTA must drive sign-up directly.

**Reconciliation:** keep the v3 visual + the "Get demo access" copy on every CTA (it's a stronger CTA label than "Sign up now" — implies a lower-commitment exploration), but every link points at `/sign-up?redirect_url=%2Fonboarding`. No modal. Pinned by the test at [`apps/web/src/app/__tests__/landing-page.test.tsx`](../../apps/web/src/app/__tests__/landing-page.test.tsx) (no waitlist copy / "Reserve my spot" / etc.).

If a future product decision reintroduces a waitlist concept, update PRD §3.5 first, then rewire the CTAs.

### 3. New v3 motion primitives added to `globals.css` (not landing.css)

The v3 design uses three motion primitives that didn't exist in `globals.css` pre-Phase 3:

| Primitive | Purpose | Where used |
|---|---|---|
| `.sk-reveal` / `-left` / `-right` / `-scale` | Scroll-reveal toggled by `RevealOnScroll`'s IntersectionObserver | Landing sections fade in as they cross the viewport |
| `.sk-d-1` … `.sk-d-6` | Per-element transition delay (60 ms steps × 6) | Stagger sk-reveal* siblings inside a row |
| `.sk-soft-pulse` | Live-status badge breathing glow | "Public link live" / "Accepting Sessions" pills |
| `.sk-float` / `.sk-float-slow` | Slow vertical float | Hero product peek (5.5 s loop / 8 s loop) |

Added to `apps/web/src/app/globals.css` between the `.tabular` utility and the existing `@media (prefers-reduced-motion: reduce)` block. Each primitive is reduce-motion-gated (see [§7](#7-motion-primitives-test-updated)) — `motion-primitives.test.ts` pins the gates.

**Phase 4 + 5 implication:** all four classes are global utilities. Phase 4 (producer dashboard) can use `.sk-soft-pulse` on the green "Accepting Sessions" pill on the Overview screen; Phase 5 (artist platform) can use `.sk-float-slow` if the FloatingPlayer warrants ambient motion.

### 4. `landing.css` slim down — 1622 lines → 135 lines

The PR #50 `landing.css` was a 76 KB verbatim port of the founder's `<style>` block. Phase 3 replaces it with a minimal stylesheet that only carries what Tailwind arbitrary-values can't express:

1. `.grad-rose` / `.grad-amber` / `.grad-slate` / `.grad-emerald` / `.grad-violet` / `.grad-indigo` / `.grad-copper` — gradient swatch classes.
2. `.landing-v3-root .hero-word` + `.landing-v3-root.is-loaded .hero-word` — hero word-fade-on-mount sequence (uses `--w-i` per-word index).
3. `.landing-v3-root .hero-peek-frame` — 3D tilt (`rotateY(-6deg) rotateX(4deg)`).
4. `.landing-v3-root .hero-grid-bg` / `.is-dark` — masked grid background.
5. `.landing-v3-root.scroll-host` — custom 4 px scrollbar.

Everything else moves to inline Tailwind arbitrary values + the motion primitives in globals.css. The `motion-primitives.test.ts` reduce-motion gate test was updated to match (the old `.landing-root *` catch-all is gone; the new test asserts `.hero-word` is gated in `landing.css` and the `sk-reveal*` family is gated in `globals.css`).

### 5. Auth — Path A (styled `<SignIn>` / `<SignUp>`, no Clerk Elements)

Per cross-cutting decision in [`docs/qa/phase-3-4-5-briefs.md`](./phase-3-4-5-briefs.md#auth):

- Built the split-screen + BrandPanel as our own layout in `apps/web/src/app/(public)/(auth)/layout.tsx`.
- Mounted Clerk's `<SignIn>` / `<SignUp>` in the right column, styled by `appearance.elements` in the root layout.
- **Lost from the design source:** custom 3-button social layout (Google + Apple + Discord) — Clerk renders its own social row; we configure providers in the Clerk dashboard. Password strength meter — Clerk handles password validation server-side. "Keep me signed in on this device" toggle — Clerk handles session persistence.
- **Kept from the design source:** every brand-panel pixel (logo + "THE HALL" eyebrow + Syne hero + "Where producers run the business of music." + social-proof avatars + city ticker), the 1.05fr / 1fr split-screen grid, mobile-first responsive collapse.

The `(public)/layout.tsx` parent sets `data-theme="chrome-dark"`. The auth layout opts BACK to warm cream via inline-style override of the same tokens — same pattern as `(public)/(legal)/layout.tsx`. The BrandPanel is dark on its own (gradient `#100E07 → #1d1810 → #2c2412`); the FormColumn hosting Clerk stays warm cream.

If a future scope decision demands the password strength meter or the "Keep me signed in" toggle to be visible, the next phase migrates to Clerk Elements (~3× the code; see [PR review notes](#review-notes-for-raz)).

### 6. Clerk appearance enhanced (`elements` extended)

The root layout's `clerkAppearance.elements` was extended with 11 new keys:
- `rootBox: "w-full"` — Clerk's outer wrapper fills the form column.
- `socialButtonsBlockButton`, `socialButtonsBlockButtonText`, `socialButtonsProviderIcon` — light surface, brand text, 16 px icons.
- `dividerLine`, `dividerText` — subtle border + uppercase mono divider label.
- `formFieldInput`, `formFieldLabel` — token-bound input surface, mono uppercase 11 px labels.
- `formFieldErrorText`, `formFieldSuccessText` — token-bound feedback messages.
- `formResendCodeLink` — amber bold "Resend" link in OTP flow.
- `otpCodeFieldInput` — JetBrains Mono 22 px extrabold OTP digit cells.
- `alert` — amber-tinted alert surface for Clerk's inline errors.

`headerTitle` switched from `font-display` to `font-syne text-[28px] font-extrabold` so "Welcome back." and "Create your account" feel as anchored as the design's H2.

Existing `variables.borderRadius` dropped from `0.75rem` to `0.625rem` so Clerk inputs match the v3 input radius (10 px) instead of the prior 12 px.

### 7. Motion primitives test updated

The previous reduce-motion gate test (`motion-primitives.test.ts`) pinned the PR #50 contract: `.landing-root *` catch-all + `.reveal-up` neutralisation in `landing.css`. With landing.css slim'd down, those selectors don't exist anymore. The test was updated to:

- Pin the v3 contract: `.hero-word` in landing.css's reduce-motion block, with `opacity:1`/`transform:none`/`transition:none` !important.
- Add a new assertion: globals.css's reduce-motion block contains `.sk-reveal`, `.sk-reveal-left`, `.sk-reveal-right`, `.sk-reveal-scale`, `.sk-soft-pulse`, `.sk-float`, `.sk-float-slow` (so a future addition of any of these primitives that forgets the gate fails CI).

### 8. Reveal-on-scroll observer rewritten

`RevealOnScroll` was rewritten to observe the v3 selector union — `.sk-reveal, .sk-reveal-left, .sk-reveal-right, .sk-reveal-scale` — and toggle `.is-in` on intersection. The previous observer queried `.landing-root .reveal-up` and toggled `.is-revealed`; both selectors are gone post-replacement.

The observer's `rootMargin` was tuned from `0px` to `0px 0px -8% 0px` and the threshold from `0.15` to `0.08` to match the v3 design source's IntersectionObserver setup (`index.html:255-257`) — the reveal fires slightly before each section fully enters the viewport, which feels more responsive on long scrolls.

Companion test [`reveal-on-scroll.test.tsx`](../../apps/web/src/components/landing/__tests__/reveal-on-scroll.test.tsx) updated in lockstep — now pins:
- Querying the v3 selector union.
- The new rootMargin / threshold.
- `.is-in` (not `.is-revealed`) is added on intersection.

### 9. /join/[slug] — no code changes (visuals already correct)

The existing `/join/[slug]/page.tsx` + components (`JoinHero`, `PublicSamplesPlayer`, `SignupCta`, locked-tracks teaser) already use:
- `.reveal-up` / `.reveal-up-delay-1..4` (auto-firing keyframe animations from `globals.css` — no IntersectionObserver dependency).
- The locked design tokens (`bg-[rgb(var(--bg-elevated))]`, `font-display`, etc.).
- The Phase 1 Dialog primitive when modal patterns are needed (none on this page).
- The correct Clerk metadata flow via `<SignupCta>` → `/sign-up/join/<slug>` → `unsafeMetadata={{signupOrigin:"join", producerSlug:slug}}` → webhook handler at `/api/webhooks/clerk`.

**No code changes** to /join/[slug] in Phase 3. The Phase 3 brief permitted enhancement; my read after exploration was that the existing implementation already satisfies the v3 visual contract for this surface. If Phase 4 or 5 surfaces a need (e.g. inline product preview on /join/<slug> driven by storefront data), that's a new scope decision.

### 10. About replaced; Privacy + Terms cleaned up

- `/about` — replaced with a tighter founder-tone variant (~150 words, matches the v3 landing's FounderNote section's voice + the "$4k mix" origin story). Drops the "v1 today" / "what's coming" feature-list cards (those duplicated landing copy + risked drift).
- `/privacy` — `fontVariationSettings: '"opsz" 144'` removed from H1 and Section H2s (Fraunces was retired in Phase 1 — `'opsz' 144` was a no-op on Syne). `font-display` swapped to `font-syne`.
- `/terms` — same cleanup as Privacy.

The `(legal)/layout.tsx` itself is unchanged — the inline-LIGHT_TOKENS-override pattern still resolves correctly.

---

## Files added (Phase 3 scope)

None — every Phase 3 surface uses an existing path.

## Files modified (Phase 3 scope)

| File | Change |
|---|---|
| `apps/web/src/app/globals.css` | +75 lines — added `.sk-reveal*` / `.sk-d-*` / `.sk-soft-pulse` / `.sk-float*` rules + reduce-motion gates. |
| `apps/web/src/components/landing/reveal-on-scroll.tsx` | Rewrote selector + class toggle for v3. |
| `apps/web/src/components/landing/__tests__/reveal-on-scroll.test.tsx` | Updated assertions for new selector + threshold. |
| `apps/web/src/styles/landing.css` | 1622 → 135 lines (slim'd to gradient swatches + hero word-fade + 3D tilt + scroll host). |
| `apps/web/src/components/landing/landing-page.tsx` | Wholesale rewrite — v3 single-file port, 11 sections, mobile-responsive, no waitlist modal. |
| `apps/web/src/app/__tests__/landing-page.test.tsx` | Rewrote assertions for v3 section IDs + CTA contract. |
| `apps/web/src/app/__tests__/motion-primitives.test.ts` | Updated landing.css reduce-motion assertions for v3 contract; added globals.css sk-reveal* gate assertion. |
| `apps/web/src/app/(public)/(auth)/layout.tsx` | Wholesale rewrite — split-screen BrandPanel + FormColumn. |
| `apps/web/src/app/layout.tsx` | Extended `clerkAppearance.elements` with 11 new keys for the split-screen tonal context. |
| `apps/web/src/app/(public)/(legal)/about/page.tsx` | Replaced with v3-aligned founder-tone version (~150 words). |
| `apps/web/src/app/(public)/(legal)/privacy/page.tsx` | Dropped `fontVariationSettings` (Fraunces retired); `font-display` → `font-syne`. |
| `apps/web/src/app/(public)/(legal)/terms/page.tsx` | Same cleanup as Privacy. |

## Files deleted

None — every Phase 3 file was either modified in place or wholesale-replaced.

---

## Out-of-scope discipline (verified)

The Phase 3 brief was explicit: don't touch `(producer)/`, `(artist)/`, tRPC routers, DB schema, Clerk webhook logic, existing primitives/layouts/shells (Phase 1 + 2). `git diff --name-only v3-clean..HEAD` confirms:

- **Zero changes** under `apps/web/src/app/(producer)/`.
- **Zero changes** under `apps/web/src/app/(artist)/`.
- **Zero changes** under `apps/web/src/server/`.
- **Zero changes** under `packages/db/`.
- **Zero changes** to `apps/web/src/app/api/webhooks/clerk/`.
- **Zero changes** to `apps/web/src/components/ui/` (Phase 1 primitives).
- **Zero changes** to `apps/web/src/components/shell/` or `nav/` (Phase 2 chrome).
- **Zero new dependencies** in `apps/web/package.json`.

Tokens added to `globals.css` are NEW additions only — no existing tokens were redefined or removed.

---

## Verification (re-checked 2026-05-05 on `phase-3-public`)

```
$ pnpm typecheck
packages/db typecheck: Done
apps/web typecheck:    Done

$ pnpm lint
apps/web lint: Done

$ pnpm -F web test
Test Files  93 passed | 1 skipped (94)
Tests       987 passed | 4 skipped (991)

$ pnpm -F web build
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Generating static pages
- /, /sign-in/[[...sign-in]], /sign-up/[[...sign-up]],
  /sign-up/join/[slug]/[[...rest]], /join/[slug], /about,
  /privacy, /terms — all routes compile.
```

**Tests delta vs Phase 2 baseline:** +1 (986 → 987). The new test in `motion-primitives.test.ts` asserts globals.css's reduce-motion block covers the new sk-reveal* primitives.

---

## Manual verification (Gili)

The brief notes Claude can't do reliable browser-mode visual verification. Per the cross-cutting decision: "Test in REAL browser at `localhost:3000` — Claude preview pane cannot follow Clerk auth redirects (known limitation, not a bug)." Gili must run:

```
$ pnpm dev
```

…and visually confirm:

1. **Landing desktop** (`/` at ≥ 1024 px) — dark hero with shine overlay, word-fade animation on first paint ("One app. Your whole studio."), 3D-tilted product peek with floating "Session booked" + "Invoice paid" toasts, Stack Replace side-by-side, 3 alternating feature heroes (Storefront mock / Locked download / Automation messages), 6-card feature grid, dark "Setup" section, FounderNote, $29 pricing card, FAQ accordion, dark Final CTA, footer. Sections fade in as you scroll.
2. **Landing mobile** (`/` at < 1024 px, e.g. DevTools 375 × 812) — same 8 sections, single column, no product peek (replaced by stacked hero — desktop only renders the 3D mockup). Mobile menu toggle works (hamburger → × → fold-out with 4 anchor links + Sign in + Get demo access).
3. **Sign-in** (`/sign-in` desktop) — split-screen with BrandPanel left (gradient bg, "THE HALL" eyebrow, Syne hero, social-proof avatars, city ticker) + Clerk `<SignIn>` form right (warm-cream background, amber primary button, mono uppercase labels). Mobile: BrandPanel collapses to wordmark + condensed eyebrow + form below.
4. **Sign-up** (`/sign-up` desktop) — same split-screen, "Create your account" header, social buttons + email + password fields, "Already have an account?" link to /sign-in.
5. **Sign-up via /join/<slug>** — visit `/join/<your-slug>`, click "Sign up to hear the full catalog + book a session →", land on `/sign-up/join/<slug>` with the same split-screen surface. **Verify:** the underlying webhook flow attaches the artist to the producer (existing behaviour — Phase 3 didn't touch the webhook).
6. **/join/<slug>** — visit `/join/<your-slug>` (must be a real producer slug). Visual is unchanged from Phase 2 (existing `<JoinHero>` / `<PublicSamplesPlayer>` / `<SignupCta>`). Confirm the page still loads + samples play + CTA works.
7. **/privacy, /terms, /about** — each loads on the warm-cream LegalLayout with the v3 Syne H1. About should read with the new founder-tone copy ("$4k mix" origin story).

If any visual feels off — especially Clerk's `<SignIn>` form not picking up the new `appearance.elements` keys — that's a Clerk-internal class-name change in a recent SDK version. Bump `@clerk/nextjs` and re-test, or escalate to me.

---

## Phase 4 + Phase 5 starting points

When Phase 4 (producer dashboard) and Phase 5 (artist platform) begin migrating screens to the v3 design:

1. **`.sk-reveal*` primitives are now site-wide.** Use them on any non-landing surface that benefits from scroll-reveal. Mount `<RevealOnScroll />` once at the top of any page that uses them (it's a no-op when no `.sk-reveal*` elements exist in the DOM). The `.reveal-up` / `.reveal-up-delay-1..4` keyframe-based pattern is still around in globals.css and continues to auto-fire — use them when a one-shot mount animation is wanted (e.g. `JoinHero`).
2. **`.grad-*` swatches** are in `landing.css`, but the file is imported by `apps/web/src/app/page.tsx` only. If a non-landing page wants to use them, either: (a) move the swatches to `globals.css`, or (b) inline the `linear-gradient(...)` call in the consumer component. The 7 swatches collectively are ~7 lines — moving them to globals is cheap if needed.
3. **The Clerk appearance contract** is now richer (11 new `elements` keys). Phase 4 + 5 don't need to touch this — every Clerk surface (sign-in, sign-up, /sign-up/join/[slug], the UserButton dropdown) inherits the new style automatically.
4. **The split-screen pattern** is reusable if a future "share producer link" surface needs an authenticated-style brand-panel + form layout. Don't import the components directly — extract `BrandPanel` + `FormColumn` into `apps/web/src/components/auth/` if there's a second consumer.

---

## Review notes for Raz

A few things to look at when you review the PR:

1. **The waitlist retirement** is the biggest deviation from the design source. I kept the visual + the "Get demo access" copy but every CTA goes to `/sign-up?redirect_url=/onboarding`. The test pins this. If you want the modal back, update PRD §3.5 first.
2. **The hero word-fade** runs once on first paint via `useEffect` setting `.is-loaded` on the root. SSR ships at opacity 0 — so first-paint for a JS-disabled visitor is invisible hero copy. The reduce-motion gate forces visibility, so most real users are fine, but you might want to double-check for the `?_rsc=1` no-JS case.
3. **The product peek is desktop-only** (`hidden lg:flex` on the floating toasts; the browser frame itself renders on mobile but takes vertical real estate). I considered hiding the whole thing on mobile to tighten the hero — let me know if you want that.
4. **Path A trade-offs** — see [§5](#5-auth--path-a-styled-signin--signup-no-clerk-elements). I lost the password strength meter, the "Keep me signed in" toggle, and the exact Google/Apple/Discord button layout. Clerk's defaults cover the same functionality. If you want any of these back, flag it and I'll migrate to Clerk Elements as a follow-up.
5. **The motion-primitives test rewrite** removes the old `.landing-root *` catch-all assertion. New assertions cover `.hero-word` (the only landing.css-specific motion now) + the sk-reveal*/sk-soft-pulse/sk-float family in globals.css. Same a11y intent, narrower scope.
