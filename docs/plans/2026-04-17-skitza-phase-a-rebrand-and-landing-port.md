# Phase A — Rebrand + Landing Page Port

**Date:** 2026-04-17
**Status:** Design (approved by user, ready for implementation plan)
**Supersedes:** none
**Precedes:** Phase B (data-model rework for packages, booking, contracts, payments, project rooms), Phase C (CRM, follow-up automation, Stripe, artist role)

---

## 1. Context

The product built through 2026-04-16 (Phase 1 weeks 1–5) implemented roughly 20% of the intended Skitza surface: Producer onboarding → public portfolio → magic lead links → analytics. All the infrastructure (Clerk, Neon, Drizzle, tRPC, Vercel, tests, CI) is solid.

On 2026-04-17 the user shared two reference artifacts:

- `StudioFlow_PRD.md` — full PRD from a prior attempt. Two-sided (Producer + Artist) studio-business platform covering booking, packages, contracts, payments, project rooms with version stacking, CRM, automated follow-ups.
- `index.html` — a complete marketing landing page the user designed. It is the canonical expression of brand identity, tone, and product positioning.

The user's feedback: "the design is too dark, should be more fun" and "the flow is far from what I imagined."

The gap between what exists and what's wanted is large. Phase A addresses the **visible** part of the gap (brand + landing) without touching the data model. Phase B+ will rewire the core flows.

## 2. Goal

Ship a version of Skitza by morning that:

- **Looks and feels like the user's `index.html`** — warm cream primary surface, amber + copper accents, Syne + Outfit typography, playful character, cinematic light→dark transition on the landing.
- **Is immediately shareable** — `skitza-v2-web.vercel.app` renders the new landing with a working waitlist form. User can post the URL to Instagram stories / Discord tonight and start collecting producer emails while Phase B is built underneath.
- **Keeps all existing working flows** — Clerk auth, onboarding, portfolio, magic lead links, analytics, settings. No feature is removed; only reskinned.

## 3. Non-goals (explicitly out of scope for Phase A)

- Any change to the data model (no new Drizzle tables except `waitlist` — see §6).
- The 6-step flow features: packages, native booking, contracts, payments, project rooms with versions, CRM, lead kanban, automated follow-ups. All Phase B+.
- Artist role / Artist dashboard. Phase C.
- Hebrew/RTL support. Deferred per original Phase-1 plan (English at launch).
- Wavesurfer-based audio. The current custom `TrackPlayer` stays.
- Retiring the magic-link feature. Infrastructure stays; its meaning shifts in Phase B.
- Retiring the `/p/[slug]` route. Route stays; its *content* shifts in Phase B (from music-magazine hero to storefront + packages + tracks-as-scroll-section).

## 4. Design decisions

### 4.1 Typography stack
Replace Fraunces + IBM Plex Sans + IBM Plex Mono with:

- **Syne** (700, 800) — display face. Matches the landing's `.syne` class usage on H1s + watermark digits.
- **Outfit** (300, 400, 500, 600) — body + UI. Matches the landing's `.outfit` / `var(--font-body)` usage everywhere.
- **Monospace** — keep a system mono fallback (`ui-monospace, SFMono-Regular, …`). The landing doesn't use a branded mono; we retire IBM Plex Mono to reduce font-weight bloat.

Both loaded via `next/font/google` so they self-host and produce zero CLS. Variable names: `--font-display`, `--font-body`, `--font-mono` (unchanged — only the values swap).

### 4.2 Palette tokens
`globals.css` `@layer base` rewritten to match the landing's token set:

```
:root {
  --bg-base:      242 237 230;   /* warm cream  #F2EDE6  (LIGHT default) */
  --bg-elevated:  255 251 245;
  --bg-sunken:    232 224 214;
  --bg-overlay:   255 254 250;

  --fg-primary:   26 23 20;      /* near-black  #1A1714 */
  --fg-secondary: 107 101 96;    /* warm gray   #6B6560 */
  --fg-muted:     140 132 124;
  --fg-inverse:   242 237 230;

  --brand-primary:     212 150 10;   /* amber       #D4960A */
  --brand-accent:      176 104 48;   /* copper      #B06830 */
  --amber-glow:        212 150 10 / 0.15;

  --fg-danger:         204 58 46;
  --fg-warning:        212 150 10;
  --fg-success:        70 140 70;

  --border-subtle:     0 0 0 / 0.08;
  --border-strong:     0 0 0 / 0.18;
}

[data-theme="chrome-dark"] {
  --bg-base:      17 16 9;        /* #111009 */
  --bg-elevated:  26 24 20;       /* #1A1814 */
  --bg-sunken:    12 10 5;
  --bg-overlay:   34 32 24;       /* #222018 */

  --fg-primary:   237 232 226;    /* #EDE8E2 */
  --fg-secondary: 122 114 104;    /* #7A7268 */
  --fg-muted:     89 82 76;
  --fg-inverse:   17 16 9;

  --border-subtle: 255 255 255 / 0.07;
  --border-strong: 255 255 255 / 0.18;
}
```

Key shifts from today:

- `:root` is LIGHT (was dark). Dark moves to `[data-theme="chrome-dark"]` attribute.
- Signal-green (`34 197 94`) is retired. Brand accent becomes amber + copper.
- `--bg-base` channel format stays `R G B` (for `rgb(var(--bg-base))`), but slash-alpha tokens like `--border-subtle` now include the alpha in-token (matching the landing's `rgba(...)` usage).

### 4.3 Landing page port
The landing page has 8 sections:

1. Hero (LIGHT world) — headline "Stop chasing payments. Just make music." + two CTAs + 3 floating mockup cards + waitlist CTA + trust bar.
2. Pain — 6 meme-face pain cards.
3. Solution — flow diagram `Lead → Booking → Session → Invoice → Delivery → Follow-up`.
4. Features — 7 tabbed feature views.
5. Consolidation — "9+ tools replaced" grid.
6. How it works — 3-step setup.
7. Testimonials — 3 quote cards (placeholder copy for now — matches landing's current content, real quotes Phase B).
8. Pricing — single $29/mo early-access card with waitlist CTA.
9. Final CTA — "The studio that runs itself is here."

Port strategy:

- Create `apps/web/src/app/page.tsx` (REPLACING the current landing) + supporting components under `apps/web/src/components/landing/*`.
- Each section is its own file for readability and future edits. Names mirror the section IDs: `hero.tsx`, `pain-grid.tsx`, `solution-flow.tsx`, `features-tabs.tsx`, `consolidation.tsx`, `how-it-works.tsx`, `testimonials.tsx`, `pricing.tsx`, `final-cta.tsx`.
- The landing's nav + wordmark become reusable: `components/landing/landing-nav.tsx` + `components/brand/skitza-mark.tsx` (the character-with-headphones SVG).
- Custom CSS for the character illustrations and the cinematic dissolve goes into a scoped CSS module (`landing.module.css`) to avoid bleeding into app-wide tokens.
- Motion primitives (`drift`, `pulse-glow`, `pulse-ambient`, `reveal-up`) are declared in `globals.css` so the app pages can reuse them.
- The landing's "theme-transition" dissolve (light hero → dark dark-world) is implemented as a sentinel `<div>` with a CSS mask-gradient, matching the landing exactly.

The 7 feature tabs each show a mockup matching the landing's exact markup. These are STATIC JSX — we are NOT wiring the mockups to real data (the real data is Phase B).

### 4.4 Waitlist
The landing has a "Join The Waiting List" CTA in the nav, hero, and final CTA. Current Skitza has no waitlist capture. We add the minimum viable implementation:

- New Drizzle table `waitlist` (schema in §6).
- New Server Action `joinWaitlist({ email })` with zod validation + insert-on-conflict-do-nothing.
- New client component `components/landing/waitlist-form.tsx` — inline email input, optimistic "You're in" state, error path.
- All three CTAs on the landing open a minimal in-page form (either inline or modal — inline is less code, favored).
- Rate-limit per IP using the existing `checkRateLimit` helper (10/min/IP is more than enough).

### 4.5 Global reskin of existing app pages
The landing port AND the existing app pages both use the same `globals.css` tokens. After we swap tokens:

- Dashboard, Portfolio, Lead Links, Settings, Onboarding, Public portfolio, 404, Error — all pick up the new palette automatically.
- Font variables (`--font-display` / `--font-body`) change — all uses of `font-display` / `font-mono` utility classes continue to work; they now resolve to Syne / (mono fallback).
- **Inspection pass required**: the current app pages use `text-[rgb(var(--brand-primary))]` etc. on the assumption "primary = green on dark bg." After the token swap, primary = amber on cream bg. Some color combinations will look wrong (e.g., a green pill on a dark surface now becomes an amber pill on a cream surface — likely fine, but need to eyeball each page).
- **What must be re-theme-audited after token swap**:
  - Public portfolio hero — uses ambient green/amber blobs on dark bg. Post-swap the hero should use `[data-theme="chrome-dark"]` since the public portfolio is CONTENT (dark mode feels right). Every producer sees the same dark for their portfolio; this avoids per-producer theming for Phase A.
  - Dashboard, portfolio, leads, settings — switch to LIGHT default (warm cream), since the app IS the producer's workspace and the landing establishes light as the resting state.
  - Onboarding — LIGHT, hero-ish.
  - Auth pages (Clerk) — LIGHT.
  - 404 + error — LIGHT.

So the rule is: **LIGHT for producer-facing + marketing + auth. DARK (`data-theme="chrome-dark"`) for the public portfolio** (which is consumption-oriented, like a record sleeve). This matches the landing's own light→dark dramaturgy.

### 4.6 Clerk theming
Current `clerkAppearance` has hex values hard-coded for dark. Update to light-mode hex values matching the new `:root`. No other Clerk API changes.

### 4.7 Favicon + OG images
Current `icon.tsx` and `opengraph-image.tsx` use the old obsidian + green palette. Rewrite to amber + copper on cream. The producer-specific OG (`/p/[slug]/opengraph-image`) stays dark (the public page is dark).

### 4.8 What we are NOT changing
- tRPC routers (portfolio, magicLink, producer).
- Drizzle schema (except adding `waitlist` table).
- Middleware / Clerk setup / auth flows.
- Vercel config, CI, env vars.
- Test suite shape — may add 1-2 tests for the new waitlist action.

## 5. Data flow

Only one new flow: **waitlist capture**.

```
Landing page → WaitlistForm (client) → joinWaitlist action (server)
  → zod validate → checkRateLimit per-IP
  → Neon: INSERT INTO waitlist (email) ON CONFLICT (email) DO NOTHING
  → { ok: true, alreadyExists: boolean } → client toast "You're in"
```

All other flows (onboarding, portfolio CRUD, magic link issue / redeem, analytics) are unchanged.

## 6. Schema changes

One new table:

```sql
CREATE TABLE "waitlist" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "source" text,              -- e.g. "landing-hero", "landing-footer", "landing-nav"
  "user_agent" text,
  "ip_hash" text,             -- sha256(ip) — no raw IPs stored
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "waitlist_email_unique" UNIQUE ("email")
);
```

Rationale:

- `source` lets us A/B which CTA converts best (Phase B analytics).
- `ip_hash` (not raw IP) matches the privacy posture of `magic_link_views` and honors the privacy page's "no raw IPs" commitment.
- `ON CONFLICT DO NOTHING` on email so re-submitting the same email is idempotent (the form says "You're in" either way — the user doesn't need to know if they were already on the list).

Migration: new `0002_waitlist.sql` generated by drizzle-kit. Applied via `pnpm db:migrate` as we did for the previous migration.

## 7. Error handling

- **Waitlist action failures** (DB down, zod fails, rate-limit exceeded): return `{ ok: false, error: string }` with a friendly message. Client shows inline error, no crash.
- **Font loading fallback**: `next/font/google` has `display: "swap"` so text renders immediately in the fallback, then re-layouts when Syne/Outfit arrive. Minor visual shift at first paint, acceptable.
- **Landing page server render**: Hero is a Server Component. If signed in, redirect to `/dashboard` (same as today). No new failure paths.
- **Existing pages under re-skin**: retheme does not introduce new error paths. All existing error.tsx and loading.tsx keep working.

## 8. Testing

Unit:

- `lib/rate-limit/in-memory.test.ts` — already exists, no change.
- New: `app/api/waitlist/actions.test.ts` — 4 cases (happy, dup email, bad email, rate-limited).

Integration:

- None required for Phase A. The existing 91 tests should remain green after retheme (no structural changes).

Smoke:

- Manual: sign up a fresh email on the live waitlist, confirm row in Neon.
- Manual: click every landing section CTA, confirm anchor scroll + form mount.
- Manual: visit `/dashboard`, `/p/<slug>`, `/sign-in` in a fresh incognito — confirm everything looks right with new palette.
- Playwright (automated, end of Phase A): revisit the prior e2e flow (sign up → onboarding → track → issue link → public portfolio → analytics) to confirm the retheme didn't break anything functional.

## 9. Implementation order (what gets built in what sequence)

1. **Tokens + fonts** — swap `globals.css` palette + tokens, swap `layout.tsx` fonts to Syne + Outfit + system mono. Commit. Verify app pages still render coherently (colors may look strange on pages I haven't re-themed yet, but no runtime errors).
2. **Clerk appearance** — update hex values to match new light-mode palette. Commit.
3. **Public portfolio dark-theming** — add `data-theme="chrome-dark"` on `/p/[slug]` wrapper so it stays dark while everything else flips light. Commit.
4. **Favicon + OG** — rewrite with amber on cream. Commit.
5. **Waitlist schema** — new migration + apply to Neon. Commit.
6. **Waitlist action + component** — server action + client form. Unit tests. Commit.
7. **Landing page port** — full 8-section rebuild. Commit.
8. **Per-page spot-check** — dashboard, portfolio, leads, settings, onboarding. Adjust any color-coded components (Badge variants, StatusPill) that now read wrong. Commit.
9. **Playwright e2e** — full happy-path pass. Fix anything that regressed.
10. **Push to origin/main** — one deploy lands the whole thing.

## 10. Success criteria (how we know Phase A is done)

- `https://skitza-v2-web.vercel.app` renders the ported landing in warm cream + amber + Syne/Outfit, matching the reference `index.html` within reasonable faithfulness (pixel-perfect is not required — the goal is "feels the same").
- Waitlist form captures emails to Neon, confirmed by direct query.
- Signed-out visitor sees the landing; signed-in producer is redirected to `/dashboard`.
- Signing up + going through onboarding + adding a track + issuing a magic link + visiting the public portfolio still works end-to-end.
- No regressions in the unit test suite.
- No new lint / typecheck / build errors.
- User (upon waking) says the app feels fun, not too dark.

## 11. Out-of-scope fallbacks / explicit punts

- **The mockup content in the Features section is static JSX copy of the landing's static markup.** We are not wiring "Invoice #0042 — Paid ✓" to real data. In Phase B, these mockups become live-data screenshots.
- **WhatsApp integration**: landing mentions "WhatsApp automation." No WhatsApp wiring in Phase A. A future implementation lands in Phase C.
- **Real testimonials**: the landing has placeholder quotes ("Jordan M., Mixing Engineer"). Ports as-is. Real quotes or a beta-disclaimer overlay comes when a real beta ships.
- **$29/mo pricing wiring**: the pricing card button says "Claim Early Access Pricing →" — in Phase A it acts as a waitlist CTA (same as others). Stripe checkout is Phase C.
