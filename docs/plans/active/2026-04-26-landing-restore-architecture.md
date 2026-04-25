# Landing page restore — Architecture

**Brief:** [2026-04-26-landing-restore-brief.md](./2026-04-26-landing-restore-brief.md)
**PRD:** §3.5 (committed in `0244454`)
**Source HTML:** [2026-04-26-landing-restore-source.html](./2026-04-26-landing-restore-source.html) (founder's original design — 2,051 lines)

This doc tells subagents *exactly* what to build and how. Cite file paths, line ranges, test assertions. No vibes.

---

## Goal

Replace every component under `apps/web/src/components/landing/` with a port of the founder's original static-HTML design at `2026-04-26-landing-restore-source.html`, preserving the CSS literally. Add 6 new sections (TrustBar, Compare, Security, FAQ, Founder, Download) restyled to match the warm aesthetic. Wire all CTAs to `/sign-up?redirect_url=/onboarding`. No schema, no tRPC, no migration.

---

## File structure

### Created (new files)

| Path | Purpose | Story |
|---|---|---|
| `apps/web/src/styles/landing.css` | Verbatim port of source `<style>` block (lines 12-1144) + scoped `--light-bg`/`--amber`/`--copper` tokens under `.landing-root` | S1 |
| `apps/web/src/components/landing/trust-bar.tsx` | New — social-proof logo strip | S3 |
| `apps/web/src/components/landing/security.tsx` | Restyled in warm aesthetic (already exists but token-based; full rewrite) | S3 |
| `apps/web/src/components/landing/faq.tsx` | New — accordion section | S3 |
| `apps/web/src/components/landing/founder.tsx` | Restyled in warm aesthetic (already exists; full rewrite) | S3 |
| `apps/web/src/components/landing/download.tsx` | Restyled in warm aesthetic (already exists; full rewrite) | S3 |
| `apps/web/src/components/landing/compare.tsx` | Restyled in warm aesthetic (already exists; full rewrite) | S3 |
| `apps/web/src/components/landing/noise-overlay.tsx` | New — fixed-position SVG noise layer (lines 63-73 of source) | S1 |
| `apps/web/src/app/__tests__/landing-page.test.tsx` | Smoke test + auth redirect + CTA hrefs | S4 |

### Rewritten (existing files, full replacement)

| Path | Source lines | Story |
|---|---|---|
| `apps/web/src/app/page.tsx` | n/a (preserves auth redirect, restructures imports) | S1 |
| `apps/web/src/app/layout.tsx` | n/a (adds `next/font/google` Outfit + Syne) | S1 |
| `apps/web/src/components/landing/landing-nav.tsx` | 1148-1187 | S2 |
| `apps/web/src/components/landing/hero.tsx` | 1190-1269 | S2 |
| `apps/web/src/components/landing/pain-grid.tsx` | 1278-1410 (`#pain` section) | S2 |
| `apps/web/src/components/landing/solution-flow.tsx` | 1413-1441 (`#solution` section) | S2 |
| `apps/web/src/components/landing/features-tabs.tsx` | 1444-1660 (7-tab carousel) | S2 |
| `apps/web/src/components/landing/how-it-works.tsx` | 1707-1734 | S2 |
| `apps/web/src/components/landing/consolidation.tsx` | 1663-1704 | S2 |
| `apps/web/src/components/landing/testimonials.tsx` | 1737-1760 | S2 |
| `apps/web/src/components/landing/pricing.tsx` | 1763-1795 | S2 |
| `apps/web/src/components/landing/final-cta.tsx` | 1798-1809 | S2 |
| `apps/web/src/components/landing/site-footer.tsx` | 1810-1846 | S2 |
| `apps/web/src/components/landing/scroll-reveal.tsx` | (already exists; verify it matches source script lines 1920-1945) | S2 |

### NOT ported (intentionally dropped)

| Source lines | What | Why |
|---|---|---|
| 1853-1880 | Lead-capture modal (`#signupModal`) + multi-select pain chips + "Get Early Access" submit | Per PRD §3.5: friction kills conversion; pain collection moves into `/onboarding` |
| 1885-1893 | Mobile sticky CTA bar | Modal-coupled; the in-page Sign Up buttons cover this need |
| 2021-2030 | JS that wires every `.btn-primary` to open the modal | Dead code once modal is dropped |

---

## CSS strategy

### The single stylesheet

`apps/web/src/styles/landing.css` is a **verbatim port** of the source `<style>` block (lines 12-1144 of `landing-restore-source.html`).

**Two surgical changes during port:**

1. **Wrap all selectors under `.landing-root`** to scope tokens. Example:

   Source:
   ```css
   :root {
     --light-bg: #F2EDE6;
     --amber: #D4960A;
     /* ... */
   }
   body {
     font-family: var(--font-body);
     background-color: var(--light-bg);
   }
   ```

   Port:
   ```css
   .landing-root {
     --light-bg: #F2EDE6;
     --amber: #D4960A;
     /* ... */
     font-family: var(--font-body);
     background-color: var(--light-bg);
   }
   ```

   Then prepend `.landing-root ` to every other selector that targets `body`, `nav`, `header`, `section`, `.hero-ctas`, etc.

2. **Replace the source's `var(--font-head)` / `var(--font-body)` declarations** with the Next.js font CSS variables (Story 1 sets these via `next/font/google`). The names stay the same (`--font-head`, `--font-body`); only the source changes (Google `<link>` → Next font optimizer).

**No other transformations.** Line count, animation timings, color hex codes, breakpoint widths — all preserved literally.

### Why scope under `.landing-root` (not `:root`)

Authed-app routes use `:root` tokens (`--bg-base`, `--brand-primary` from `globals.css`). If landing tokens spill into `:root`, they break authed-app theming on hard navigations (cached CSS persists across route changes). Scoping under `.landing-root` guarantees the warm palette is contained to the marketing surface only.

### Tailwind interaction

The landing components reference `landing.css` classes via `className="hero-ctas"`, NOT Tailwind utilities. Tailwind still processes these files (it's project-wide), but the classes have no Tailwind matches so it leaves them alone.

**Forbidden in landing components:**
- Tailwind utility classes (`bg-amber-500`, `text-warm-100`, `pt-12`, etc.)
- References to project tokens (`bg-[rgb(var(--bg-base))]`, `text-[rgb(var(--fg-primary))]`)
- Inline styles except where the source uses them

---

## Font loading

`apps/web/src/app/layout.tsx` adds:

```ts
import { Outfit, Syne } from "next/font/google";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const syne = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-head",
  display: "swap",
});

// In the JSX:
<html lang="en" dir="ltr" className={`${outfit.variable} ${syne.variable}`}>
```

This makes `--font-body` and `--font-head` available globally as CSS variables. The landing.css uses them; the authed app ignores them (it has its own font stack).

**Why `next/font/google` not `<link>`:**
- Self-hosted at build time → zero runtime requests to Google
- Eliminates layout-shift CLS
- Matches Next.js 16 best practice

---

## Component patterns

### Server vs client

| Component | Why server / client | Source script ref |
|---|---|---|
| `page.tsx` | **Server** — auth redirect via `await auth()` | n/a |
| `layout.tsx` | **Server** — root layout, font config | n/a |
| `noise-overlay.tsx` | **Server** — pure JSX, no interactivity | lines 63-73 |
| `landing-nav.tsx` | **Client** — mobile menu toggle | lines 1184-1185, 1106-1108 (no source JS for menu — implement minimal toggle) |
| `hero.tsx` | **Client** — word-by-word fade on mount | source script lines 1898-1915 |
| `pain-grid.tsx` | **Server** | n/a |
| `solution-flow.tsx` | **Server** | n/a |
| `features-tabs.tsx` | **Client** — tab switching | source script lines 1948-2018 |
| `how-it-works.tsx` | **Server** | n/a |
| `consolidation.tsx` | **Server** | n/a |
| `security.tsx` | **Server** | n/a |
| `testimonials.tsx` | **Server** | n/a |
| `pricing.tsx` | **Server** — CTAs are `<Link>` not click handlers | n/a |
| `faq.tsx` | **Client** — accordion | new (no source) |
| `founder.tsx` | **Server** | n/a |
| `download.tsx` | **Server** | n/a |
| `final-cta.tsx` | **Server** | n/a |
| `site-footer.tsx` | **Server** | n/a |
| `scroll-reveal.tsx` | **Client** — IntersectionObserver | source script lines 1920-1945 |

### Page composition

`apps/web/src/app/page.tsx`:

```tsx
import "~/styles/landing.css";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { NoiseOverlay } from "~/components/landing/noise-overlay";
import { LandingNav } from "~/components/landing/landing-nav";
import { Hero } from "~/components/landing/hero";
import { TrustBar } from "~/components/landing/trust-bar";
import { PainGrid } from "~/components/landing/pain-grid";
import { SolutionFlow } from "~/components/landing/solution-flow";
import { FeaturesTabs } from "~/components/landing/features-tabs";
import { Compare } from "~/components/landing/compare";
import { HowItWorks } from "~/components/landing/how-it-works";
import { Consolidation } from "~/components/landing/consolidation";
import { Security } from "~/components/landing/security";
import { Testimonials } from "~/components/landing/testimonials";
import { Pricing } from "~/components/landing/pricing";
import { FAQ } from "~/components/landing/faq";
import { Founder } from "~/components/landing/founder";
import { Download } from "~/components/landing/download";
import { FinalCTA } from "~/components/landing/final-cta";
import { SiteFooter } from "~/components/landing/site-footer";

export const metadata: Metadata = { /* unchanged */ };

export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  return (
    <div className="landing-root">
      <NoiseOverlay />
      <LandingNav />
      <Hero />
      <TrustBar />
      <main className="dark-world">
        <PainGrid />
        <SolutionFlow />
        <FeaturesTabs />
        <Compare />
        <HowItWorks />
        <Consolidation />
        <Security />
        <Testimonials />
        <Pricing />
        <FAQ />
        <Founder />
        <Download />
      </main>
      <FinalCTA />
      <SiteFooter />
    </div>
  );
}
```

The `<main className="dark-world">` wraps the dark-themed sections (pain through download). This matches source line 1275. The light-themed sections (hero, trust bar, final CTA, footer) sit outside.

---

## CTA wiring

Every primary CTA in landing components uses:

```tsx
<Link
  href="/sign-up?redirect_url=%2Fonboarding"
  className="btn-primary"
>
  Sign up now
</Link>
```

The `?redirect_url=%2Fonboarding` query param is honored by Clerk's `<SignUp>` component natively — after the user completes sign-up, Clerk navigates to `/onboarding`.

The "Sign in" link (LandingNav only):

```tsx
<Link href="/sign-in" className="nav-link">
  Sign in
</Link>
```

**No JavaScript click handlers** for navigation. Plain `<Link>` everywhere.

### CTA inventory (find-and-replace targets)

Source lines that need updating during port:

| Source line | Original copy | Becomes |
|---|---|---|
| 1184 | `<button class="btn-primary small nav-btn">Join The Waiting List</button>` | `<Link href="/sign-up?redirect_url=%2Fonboarding" className="btn-primary small nav-btn">Sign up now</Link>` |
| 1237 | `<button class="btn-primary">Join The Waiting List</button>` | `<Link href="/sign-up?redirect_url=%2Fonboarding" className="btn-primary">Sign up now</Link>` |
| 1238 | `<button class="btn-ghost" onclick="...">See how it works ↓</button>` | `<a href="#pain" className="btn-ghost">See how it works ↓</a>` |
| 1243 | `★★★★★ Joined by 1,200+ producers on the waitlist` | `★★★★★ Built for solo producers.` |
| 1701 | `<button class="btn-ghost dark-ghost" onclick="...">See Everything Skitza Does →</button>` | `<a href="#features" className="btn-ghost dark-ghost">See Everything Skitza Does →</a>` |
| 1790 | `<button class="btn-primary full">Claim Early Access Pricing →</button>` | `<Link href="/sign-up?redirect_url=%2Fonboarding" className="btn-primary full">Sign up now →</Link>` |
| 1805 | `<button class="btn-primary">Join The Waiting List</button>` | `<Link href="/sign-up?redirect_url=%2Fonboarding" className="btn-primary">Sign up now</Link>` |

LandingNav also adds a "Sign in" link before the Sign Up button (no source equivalent).

---

## Test strategy

### Unit tests (Story 4)

`apps/web/src/app/__tests__/landing-page.test.tsx`:

```ts
import { render, screen } from "@testing-library/react";
import HomePage from "../page";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

describe("HomePage (landing)", () => {
  it("renders all 17 sections in order for signed-out visitor", async () => {
    (auth as Mock).mockResolvedValue({ userId: null });
    const ui = await HomePage();
    render(ui);
    // Spot-check a few section landmarks
    expect(screen.getByText(/Stop chasing payments/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /sign up now/i }).length).toBeGreaterThanOrEqual(3);
  });

  it("redirects signed-in producers to /dashboard", async () => {
    (auth as Mock).mockResolvedValue({ userId: "user_123" });
    await HomePage();
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("every Sign up CTA points at /sign-up with onboarding redirect", async () => {
    (auth as Mock).mockResolvedValue({ userId: null });
    const ui = await HomePage();
    render(ui);
    const signUpLinks = screen.getAllByRole("link", { name: /sign up now/i });
    signUpLinks.forEach((link) => {
      expect(link).toHaveAttribute("href", "/sign-up?redirect_url=%2Fonboarding");
    });
  });

  it("Sign in link points at /sign-in", async () => {
    (auth as Mock).mockResolvedValue({ userId: null });
    const ui = await HomePage();
    render(ui);
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/sign-in");
  });
});
```

### Reduce-motion test (Story 1)

Extend `apps/web/src/app/__tests__/motion-primitives.test.ts` to also scan `apps/web/src/styles/landing.css` — every `@keyframes` or `animation:` declaration MUST be wrapped in or accompanied by a `@media (prefers-reduced-motion: reduce)` neutralizing block.

### Visual smoke (Story 4, manual QA)

1. `pnpm -F web dev`
2. Open `http://localhost:3000/` in incognito (signed out)
3. Resize browser to 360px → verify no horizontal scroll, all 17 sections render
4. Resize to 768px → mobile menu disappears, nav links appear
5. Resize to 1440px → hero typography matches `clamp(28px, 4.5vw, 56px)` from source
6. Sign in via Clerk → reload `/` → confirm redirect to `/dashboard`
7. Click any "Sign up now" → land on `/sign-up?redirect_url=%2Fonboarding`
8. Complete sign-up → land on `/onboarding`

---

## Story breakdown

### Story 1 — Foundation + tokens (~1.5h)

**Goal:** scaffold the CSS, fonts, and noise overlay so subsequent stories can add components.

**Acceptance:**
- [ ] `apps/web/src/styles/landing.css` exists, contains the verbatim port of source lines 12-1144, all selectors scoped under `.landing-root`
- [ ] `apps/web/src/app/layout.tsx` loads Outfit + Syne via `next/font/google` and exposes `--font-body` + `--font-head` on `<html>`
- [ ] `apps/web/src/components/landing/noise-overlay.tsx` renders the SVG fractal noise (source lines 63-73)
- [ ] `apps/web/src/app/page.tsx` updated to import landing.css, wrap in `.landing-root`, render `<NoiseOverlay />` first, KEEP `if (userId) redirect("/dashboard")`, KEEP `metadata` export
- [ ] `pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test` all green
- [ ] Reduce-motion test extended to scan landing.css — all animations have a reduce gate

**Commit:** `feat(landing): S1 — CSS foundation, fonts, noise overlay`

### Story 2 — Port the 11 original sections (~5h)

**Goal:** rewrite every existing landing component to match the source HTML literally.

**Acceptance:**
- [ ] `landing-nav.tsx` — source lines 1148-1187, with **Sign In** text link added before the amber Sign Up button (`Sign up now` → `/sign-up?redirect_url=%2Fonboarding`)
- [ ] `hero.tsx` — source lines 1190-1269, word-by-word fade on mount (port script lines 1898-1915), social-proof line replaced with `★★★★★ Built for solo producers.`
- [ ] `pain-grid.tsx` — source lines 1278-1410
- [ ] `solution-flow.tsx` — source lines 1413-1441
- [ ] `features-tabs.tsx` — source lines 1444-1660, 7 tabs functional (port script lines 1948-2018)
- [ ] `how-it-works.tsx` — source lines 1707-1734
- [ ] `consolidation.tsx` — source lines 1663-1704
- [ ] `testimonials.tsx` — source lines 1737-1760
- [ ] `pricing.tsx` — source lines 1763-1795, CTA → `Sign up now`
- [ ] `final-cta.tsx` — source lines 1798-1809, CTA → `Sign up now`
- [ ] `site-footer.tsx` — source lines 1810-1846
- [ ] `scroll-reveal.tsx` verified to match source script lines 1920-1945
- [ ] All components render correctly when composed in `page.tsx`
- [ ] `pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test` all green

**Commit:** `feat(landing): S2 — port 11 original sections from founder design`

### Story 3 — Build the 6 new sections in warm aesthetic (~3h)

**Goal:** restyle TrustBar, Compare, Security, FAQ, Founder, Download to match landing.css.

**Acceptance:**
- [ ] `trust-bar.tsx` — light section between Hero and dark-world; logo strip with section label, no source ref (use placeholder logos for now: 4-6 generic music-industry logos as text, e.g., "FEATURED · Pitchfork · Resident Advisor · Bandcamp Daily · MusicTech")
- [ ] `compare.tsx` — dark section, 2-column comparison (Skitza vs the unbundled stack) using `.section-header` + a custom `.compare-grid` styled to match other dark sections
- [ ] `security.tsx` — dark section, 3-card layout (Privacy / Storage / Auth), each card uses the same surface treatment as the consolidation cards (source line ~1665+)
- [ ] `faq.tsx` — dark section, accordion of 6-8 questions, uses scroll-reveal, inline `.faq-item` styles in landing.css
- [ ] `founder.tsx` — dark section, single-column editorial layout with portrait placeholder + paragraphs in body font
- [ ] `download.tsx` — dark section, 2-card layout (Desktop · macOS/Windows · Tauri / Mobile · iOS/Android · PWA install)
- [ ] All 6 components use ONLY landing.css classes (no Tailwind utilities, no project tokens)
- [ ] All animations respect reduce-motion
- [ ] `pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test` all green

**Commit:** `feat(landing): S3 — build TrustBar, Compare, Security, FAQ, Founder, Download in warm aesthetic`

### Story 4 — CTAs, auth wiring, and verification (~1.5h)

**Goal:** confirm every CTA routes correctly, write the page-level test, run full verification.

**Acceptance:**
- [ ] `apps/web/src/app/__tests__/landing-page.test.tsx` exists with the 4 test cases above (renders, redirects, all sign-up CTAs use the right href, sign-in link)
- [ ] Manual smoke: visit `/` in dev at 360 / 768 / 1440 — every section renders, no horizontal scroll, mobile menu toggles
- [ ] Manual smoke: click each "Sign up now" → confirm Clerk loads with `redirect_url=/onboarding`
- [ ] Manual smoke: complete sign-up → land on `/onboarding`
- [ ] `/skitza-verify` (typecheck + lint + test + build) all green
- [ ] Compare to source HTML rendered in a browser — typography, palette, animations match
- [ ] No fabricated social proof anywhere on the page

**Commit:** `feat(landing): S4 — CTA wiring, page tests, verification`

---

## Hard rules for every story

1. **No Tailwind utility classes in landing components.** Only `landing.css` class names.
2. **No `--bg-base`/`--brand-primary` token references** in landing components or landing.css.
3. **No framer-motion, no animation libraries.** CSS keyframes + IntersectionObserver only.
4. **No new dependencies** without explicit user approval.
5. **All animations** wrapped in `@media (prefers-reduced-motion: reduce)` gate.
6. **All `<Link>` for in-app navigation** (no `<a href>` for internal links — use Next.js `<Link>`).
7. **Server components by default.** Add `"use client"` only when interactivity is required.
8. **`if (userId) redirect("/dashboard")` stays** at the top of `page.tsx`.
9. **English-only.** Zero `useTranslations()`, zero `t()`, zero locale logic.
10. **Verify before commit:** `pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test` MUST pass.

---

## Risks + mitigations (per story)

| Risk | Story | Mitigation |
|---|---|---|
| `landing.css` accidentally pollutes authed-app via cached CSS | S1 | Scope all selectors under `.landing-root`; verify in dev by signing in mid-session, navigating to /dashboard, confirming no warm-palette bleed |
| `next/font/google` build-time download fails in CI | S1 | Test locally first; fallback is `<link rel="preconnect">` + Google Fonts URL |
| Source HTML uses `onclick="..."` inline handlers — these don't transfer to React | S2 | Convert to `<a href="#anchor">` (smooth scroll via CSS `scroll-behavior: smooth`) or `<Link>` for routing. Listed in CTA inventory above. |
| 7-tab `features-tabs.tsx` needs JS port from source script | S2 | Source lines 1948-2018 contain the tab switching logic. Port as React state (`const [activeTab, setActiveTab] = useState(0)`) instead of DOM mutation. |
| 6 new sections look bolted-on if not carefully restyled | S3 | Follow `landing.css` conventions: `.section`, `.container`, `.section-header`, `.label`, `clamp(28px, 4.5vw, 56px)` for H2. QA reviews against the warm aesthetic. |
| Clerk `redirect_url` query param not honored | S4 | Verified via manual smoke test; if broken, alternative is `<SignUp afterSignUpUrl="/onboarding" />` configured at Clerk's middleware level |

---

## Verification (Ship phase)

After Story 4 commits and tests pass:

1. `pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test` (in worktree at `/Users/giliasraf/skitza-landing-restore`)
2. `pnpm -F web build` — production build succeeds
3. `pnpm -F web start` — production server, smoke-test landing at 3 breakpoints
4. `git push -u origin feat/landing-restore`
5. `gh pr create --title "feat(landing): restore founder's original design + 6 new sections" --body "..."`
6. Vercel preview URL appears in PR — manual QA on the preview before merge
