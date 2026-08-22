import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Page-level test for the landing route — Phase 3 v3 (replaces the
// PR #50 verbatim-port test pinning the old `pain` / `solution` /
// `compare` / `consolidation` / `download` section IDs).
//
// Pins the same composition contract that the PR #50 build pinned,
// against the v3 single-component output:
//   1. Auth redirect — signed-in accounts MUST pass through /auth/resolve
//      and the landing markup MUST NOT render at all.
//   2. Section composition for signed-out visitors — every section's
//      distinguishing landmark is present in the rendered markup, in
//      order. The 11 v3 sections are sibling JSX in landing-page.tsx;
//      this test asserts each id / class fingerprint is present.
//   3. CTA wiring — Producer marketing CTAs explain invitation-only access.
//   4. No fabricated social proof / no waitlist copy.
//
// In-repo testing convention: `react-dom/server` `renderToStaticMarkup`
// (no `@testing-library/react`). Assertions are structural string
// matches against the rendered HTML.

type AuthResult = { userId: string | null };
const authMock = vi.fn<() => Promise<AuthResult>>();
const redirectMock = vi.fn((path: string) => {
  // Mirror Next.js's runtime behaviour: `redirect()` throws to halt
  // server-component execution. Tests that rely on the page returning
  // markup must mock auth() to return userId=null so this path is not
  // hit.
  throw new Error(`__REDIRECT__:${path}`);
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

beforeEach(() => {
  authMock.mockReset();
  redirectMock.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("HomePage (landing) — composition (Phase 3 v3)", () => {
  it("lands one-click Vercel preview links on the onboarding walkthrough", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");

    await expect(HomePage({ searchParams: Promise.resolve({ __preview: "1" }) })).rejects.toThrow(
      "__REDIRECT__:/onboarding/welcome?__preview=1",
    );
    expect(redirectMock).toHaveBeenCalledWith("/onboarding/welcome?__preview=1");
    expect(authMock).not.toHaveBeenCalled();
  });

  it("does not enable the onboarding walkthrough redirect in production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");

    const ui = await HomePage({
      searchParams: Promise.resolve({ __preview: "1" }),
    });
    const html = renderToStaticMarkup(ui);

    expect(html).toContain('id="landing-root"');
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("routes signed-in accounts through invitation and membership resolution", async () => {
    authMock.mockResolvedValue({ userId: "user_123" });
    const { default: HomePage } = await import("../page");

    // The redirect mock throws to halt server-component execution —
    // mirroring Next.js runtime. The page MUST NOT return markup for a
    // signed-in producer.
    await expect(HomePage()).rejects.toThrow("__REDIRECT__:/auth/resolve");
    expect(redirectMock).toHaveBeenCalledWith("/auth/resolve");
    expect(redirectMock).toHaveBeenCalledTimes(1);
  });

  it("renders all v3 section landmarks for a signed-out visitor", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // Each landmark is a unique-in-the-page string that proves the
    // corresponding section rendered. Order in this list mirrors the
    // composition order in landing-page.tsx.

    // 1. Sticky nav — id="navbar"
    expect(html).toContain('id="navbar"');
    // 2. Hero — primary headline word "studio" (the period is colored)
    expect(html).toContain("whole");
    expect(html).toMatch(/studio/i);
    // 3. StackReplace — id="stack-replace"
    expect(html).toContain('id="stack-replace"');
    // 4. Features — id="features"
    expect(html).toContain('id="features"');
    // 5. FeatureGrid — id="feature-grid"
    expect(html).toContain('id="feature-grid"');
    // 6. How — id="how"
    expect(html).toContain('id="how"');
    // 7. Founder — id="founder"
    expect(html).toContain('id="founder"');
    // 8. Pricing — id="pricing"
    expect(html).toContain('id="pricing"');
    // 9. FAQ — id="faq"
    expect(html).toContain('id="faq"');
    // 10. FinalCTA — id="final-cta" + class "final-cta"
    expect(html).toContain('id="final-cta"');
    // 11. Footer — <footer> element
    expect(html).toContain("<footer");

    // Composition wrapper — outermost div is .landing-v3-root
    expect(html).toMatch(/^<div id="landing-root" class="landing-v3-root/);
  });

  it("renders all 6 feature-grid item titles", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // The 6 small-card feature titles in the FeatureGrid section.
    // If a card title is renamed/removed, this catches it.
    expect(html).toContain("Exact terms, accepted in-app");
    expect(html).toContain("Client history, all in one place");
    expect(html).toContain("Bookings that respect availability");
    expect(html).toContain("Private files, controlled delivery");
    expect(html).toContain("One link for each studio");
    expect(html).toContain("Works on every device");
  });

  it("renders all 3 alternating feature-hero titles", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    expect(html).toContain("One link for every Artist.");
    expect(html).toContain("Feedback stays with the right version.");
    expect(html).toContain("Keep sessions and payments moving.");
  });

  it("every primary Producer CTA points at invitation information", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // Count Producer-access href occurrences. Minimum surfaces:
    //   - Nav desktop CTA
    //   - Nav mobile menu CTA (rendered always; hidden by .lg:hidden)
    //   - Hero primary CTA
    //   - Pricing CTA
    //   - FinalCTA
    // The mobile menu fold-out only renders when `menuOpen` is true,
    // so it's NOT in the static SSR output (initial `menuOpen=false`).
    // That leaves 4 surfaces in SSR.
    const producerAccessHref = 'href="/producer-access"';
    const matches = html.match(new RegExp(escapeRegExp(producerAccessHref), "g")) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain("Start free trial");
    expect(html).not.toContain("/sign-up?redirect_url=%2Fonboarding");
  });

  it("serializes waveform heights deterministically for hydration", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain("height:71.6473%");
    expect(html).not.toContain("height:71.64733502929566%");
  });

  it("'Sign in' link points at /sign-in (nav + hero)", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // /sign-in appears twice in SSR: nav desktop + hero action group
    // (SK-246). Mobile nav fold-out is gated by `menuOpen=false` and not
    // rendered in the SSR pass, so the hero link is the only one visible
    // on phones without opening the menu.
    const signInMatches = html.match(/href="\/sign-in"/g) ?? [];
    expect(signInMatches.length).toBe(2);
    // And the link text is literally "Sign in".
    expect(html).toMatch(/href="\/sign-in"[^>]*>\s*Sign in\s*</);
    // The hero copy of the link sits inside the hero action group.
    expect(html).toMatch(/data-testid="hero-sign-in"[^>]*href="\/sign-in"/);
  });

  it("contains NO waitlist copy (PRD §3.5 — design source's WaitlistModal retired)", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // The general homepage explains invitation-backed access; it does not
    // collect a separate waitlist submission.
    expect(html).not.toMatch(/Join the Waiting List/i);
    expect(html).not.toMatch(/Join Waitlist/i);
    expect(html).not.toMatch(/waitlist/i);
    expect(html).not.toMatch(/Reserve my spot/i);
    expect(html).not.toMatch(/Get Early Access/i);
  });

  it("renders the founder note without an unverified loss amount", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    expect(html).toContain("a mix went unpaid");
    expect(html).not.toContain("$4k mix");
    expect(html).toContain("Gili Asraf");
  });

  it("describes the real beta, external-payment, and Google Calendar behavior", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain("Free");
    expect(html).toContain("during beta");
    expect(html).toContain("external-payment records");
    expect(html).toContain("Connect Google Calendar");
    expect(html).toContain("checks selected busy times to avoid conflicts");
    expect(html).toContain("Unrelated event details stay private");
    expect(html).toContain("view private products and prices after sign-in");
    expect(html).toContain("skitza.app/join/your-name");

    expect(html).not.toContain("Automated invoicing &amp; Stripe payments");
    expect(html).not.toContain("Stripe handles payment plans");
    expect(html).not.toContain("WhatsApp + email automation");
    expect(html).not.toContain("Invoice paid");
    expect(html).not.toContain("app.skitza.com");
    expect(html).not.toContain("$29");
  });

  it("renders sk-reveal classes that drive scroll-reveal (paired with RevealOnScroll)", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // The sk-reveal* primitives ship at opacity:0 in globals.css; the
    // RevealOnScroll IntersectionObserver toggles `.is-in` on each as
    // they cross the viewport. If the observer wiring breaks, every
    // sk-reveal* element stays invisible. This test pins that the
    // markup uses the v3 selectors (the test for the observer itself
    // lives at apps/web/src/components/landing/__tests__/reveal-on-scroll.test.tsx).
    expect(html).toContain("sk-reveal-left");
    expect(html).toContain("sk-reveal-right");
    expect(html).toContain("sk-reveal-scale");
    // At least one bare sk-reveal (Stack Replace label, FAQ heading).
    expect(html).toMatch(/class="[^"]*\bsk-reveal\b[^-]/);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Escape a string so it can be used safely inside a RegExp literal.
// Used by the Sign-up href counter — the href contains `?` and `%`
// which are RegExp metacharacters.
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
