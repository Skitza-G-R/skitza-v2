# Landing page restore — Brief

**Date:** 2026-04-26
**Track:** BMAD Standard
**Trigger:** Founder feedback: *"I've decided to go back to my original landing page design. I absolutely love this specific UI — the fonts, the CSS animations, the SVGs, and the logo."*
**Predecessor:** The current decomposed component-landing under `apps/web/src/components/landing/` (built across multiple PRs through April). It works but drifted toward generic-SaaS aesthetics — neutral palette, system fonts, project tokens. The founder's original static-HTML design has editorial swagger (Outfit + Syne, warm off-white + amber/copper, tactile noise, word-by-word hero fade) that the current version lost.

---

## Why we're restoring (not polishing)

This isn't a CSS tune-up. It's a deliberate aesthetic reversal.

The current landing's visual language uses the authenticated app's tokens (`--bg-base`, `--brand-primary`) and Tailwind utility classes. That keeps the marketing surface "consistent" with the product but at the cost of personality. The marketing surface needs to *sell*; the authenticated app needs to *function*. They have different jobs.

The original design was built before the component decomposition and has:
- A specific font pairing (**Outfit** body + **Syne** headings) the founder identifies with
- A warm palette (`#F2EDE6` off-white / `#111009` deep brown / `#D4960A` amber / `#B06830` copper) that's editorial, not generic-SaaS
- CSS-only animations (scroll reveal, hero word fade, hover lifts) carefully tuned
- A noise overlay for tactile feel
- A specific 7-tab feature carousel structure the founder approved

Restoration is faster and lower-risk than retrofitting personality back into the current components. We start from the known-good design and inject ONLY the modern functional requirements (auth, new sections) on top.

---

## Success signals (how we know it worked)

1. **Visual fidelity to the original.** Side-by-side compare: typography, palette, spacing, animations all match the source HTML literally. No "interpretation" or "modernization."
2. **Sign-up flow works end-to-end.** Click any "Sign up now" → land on `/sign-up` → complete Clerk → land on `/onboarding`. Zero broken CTAs.
3. **All 17 sections render.** Including the 6 sections that didn't exist in the original (TrustBar, Compare, Security, FAQ, Founder, Download) — each restyled to match the warm/amber aesthetic, NOT pasted in from the current generic-SaaS components.
4. **Mobile responsive.** Original design had `@media` queries for ≤768px. Verified working at 360px, 768px, 1024px, 1440px.
5. **Signed-in producers don't see the marketing page.** `if (userId) redirect("/dashboard")` works at the route level.
6. **No fabricated social proof on the live page.** "1,200+ producers on the waitlist" is gone. Replaced with the aspirational placeholder until real numbers exist.

---

## Scope

### In scope (this restoration)

- **Replace** every component under `apps/web/src/components/landing/` with a port that matches the original HTML/CSS literally
- **Add** the 6 new sections (TrustBar, Compare, Security, FAQ, Founder, Download) styled to match the warm aesthetic
- **Update** every "Join The Waiting List" / "Get Early Access" / "Claim Early Access" CTA to **"Sign up now"** routing to `/sign-up`
- **Add** "Sign in" text link to LandingNav (separate from the amber Sign Up button)
- **Drop** the "Join 1,200+ producers" lead-capture modal entirely
- **Replace** waitlist social-proof line with `★★★★★ Built for solo producers.`
- **Preserve** the existing auth redirect at the top of `page.tsx`
- **Add** scoped landing CSS tokens (`--light-bg`, `--amber`, etc.) — separate from the project's `--bg-base`/`--brand-primary` system

### Out of scope (future passes)

- A/B testing / experimentation scaffolding
- Email capture / lead gen forms
- Video embeds in Hero
- Internationalization of the landing (English-only, locked by PRD §3.7)
- Theme switcher (warm-light → dark-section flow IS the design)
- Tweaking the original's aesthetic ("modernizing" copy or layout)
- Landing analytics / conversion tracking (PostHog page-views are already wired globally)

---

## Hard constraints

- **Preserve the original CSS literally.** No "improvements," no "modernizing," no Tailwind utility-class refactors. The CSS lives as either an inline `<style>` block or a co-located `.css` module — but the rules and selectors match the source.
- **Outfit + Syne fonts via Google Fonts.** Loaded with `<link>` preconnect in `<head>` (Next.js metadata API or layout file).
- **No framer-motion or animation libraries.** Continue with CSS keyframes + IntersectionObserver.
- **No new dependencies.**
- **`if (userId) redirect("/dashboard")` stays.** Signed-in producers must skip the marketing page.
- **English-only, LTR-only.** Zero `useTranslations()` calls, zero `t()`, zero locale logic.
- **Landing tokens are scoped.** Defined in a landing-only stylesheet — they MUST NOT leak into the authenticated app's token system.
- **Mobile-first.** Original had responsive breakpoints; preserve them.

---

## Risks

| Risk | Mitigation |
|---|---|
| Decomposing the single-file HTML into React components introduces drift | Keep the component split shallow — one component per section (LandingNav, Hero, etc.) and a single landing-styles.css that mirrors the source `<style>` block. No premature abstraction. |
| The 6 new sections (TrustBar, Compare, Security, FAQ, Founder, Download) don't exist in the original — easy to default to generic-SaaS treatment | Architecture phase will explicitly call out the visual rules each new section must follow (warm palette, Syne H2, scroll-reveal, noise-overlay-aware). QA reviews each new section against the warm aesthetic. |
| Sign-up routing breaks if `/onboarding` redirect chain isn't right | Test the full flow: cold visitor → click "Sign up now" → Clerk `/sign-up` → submit → land on `/onboarding`. Specifically test the `redirect_url` query param Clerk forwards. |
| Mobile responsive lost during component decomposition | Carry the `@media (max-width: 768px)` block into the landing stylesheet verbatim; verify in dev at 360px before committing. |
| The amber-on-warm palette has poor contrast at small font sizes | Original used amber for accents/headings only, not body text. Preserve that rule. WCAG AA contrast spot-checked during QA. |
| Existing Sentry/PostHog instrumentation that the current landing components rely on | Audit before deletion — port any analytics calls to the new components if present. |

---

## Open questions (none blocking — all locked)

- ~~Where does "Sign up now" go?~~ → `/sign-up` → auto-redirect to `/onboarding` (locked)
- ~~Sign In + Sign Up or just Sign Up?~~ → Both visible (locked)
- ~~Which new sections to inject?~~ → All 6 (locked)
- ~~Keep, kill, or repurpose the modal?~~ → Kill (locked)
- ~~Social proof copy?~~ → "★★★★★ Built for solo producers." aspirational placeholder (locked)
