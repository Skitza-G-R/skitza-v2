import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Page-level test for the landing route (S4 — landing-restore).
//
// Pins three things at the composition layer that no individual
// component test can:
//   1. The auth redirect — signed-in producers MUST land on /dashboard
//      and the landing markup MUST NOT render at all.
//   2. The 17-section composition for signed-out visitors — every
//      section's distinguishing landmark is present in the rendered
//      markup, in order.
//   3. The CTA wiring + absence of fabricated social proof.
//
// In-repo testing convention: `react-dom/server` `renderToStaticMarkup`,
// NOT `@testing-library/react` (which is not installed). Assertions
// are structural string matches against the rendered HTML — same
// pattern as the per-component tests under
// `apps/web/src/components/landing/__tests__/`.

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

describe("HomePage (landing) — composition (S4)", () => {
  it("redirects signed-in producers to /dashboard and does NOT render landing content", async () => {
    authMock.mockResolvedValue({ userId: "user_123" });
    const { default: HomePage } = await import("../page");

    // The redirect mock throws to halt server-component execution —
    // mirroring Next.js runtime. The page MUST NOT return markup for a
    // signed-in producer.
    await expect(HomePage()).rejects.toThrow("__REDIRECT__:/dashboard");
    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
    expect(redirectMock).toHaveBeenCalledTimes(1);
  });

  it("renders all 17 section landmarks for a signed-out visitor", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // Each landmark is a unique-in-the-page string that proves the
    // corresponding component rendered. Order in this list mirrors the
    // composition order in page.tsx.

    // 1. LandingNav — id="navbar"
    expect(html).toContain('id="navbar"');
    // 2. Hero — primary headline word sequence
    expect(html).toContain("Stop");
    expect(html).toContain("chasing");
    expect(html).toContain("payments.");
    // 3. TrustBar — "As featured in" eyebrow
    expect(html).toContain("As featured in");
    // 4. PainGrid — section id="pain"
    expect(html).toContain('id="pain"');
    // 5. SolutionFlow — section id="solution"
    expect(html).toContain('id="solution"');
    // 6. FeaturesTabs — section id="features"
    expect(html).toContain('id="features"');
    // 7. Compare — section id="compare"
    expect(html).toContain('id="compare"');
    // 8. HowItWorks — section id="how-it-works"
    expect(html).toContain('id="how-it-works"');
    // 9. Consolidation — section id="consolidation"
    expect(html).toContain('id="consolidation"');
    // 10. Security — section id="security"
    expect(html).toContain('id="security"');
    // 11. Testimonials — section id="testimonials"
    expect(html).toContain('id="testimonials"');
    // 12. Pricing — section id="pricing"
    expect(html).toContain('id="pricing"');
    // 13. FAQ — section id="faq" (faq.tsx renders id="faq")
    expect(html).toContain('id="faq"');
    // 14. Founder — section id="founder"
    expect(html).toContain('id="founder"');
    // 15. Download — section id="download"
    expect(html).toContain('id="download"');
    // 16. FinalCTA — class "final-cta"
    expect(html).toContain('class="final-cta"');
    // 17. SiteFooter — <footer> element
    expect(html).toContain("<footer>");

    // Composition wrapper — outermost div is .landing-root
    expect(html).toMatch(/^<div class="landing-root">/);
  });

  it("renders FeaturesTabs with all 7 tab labels", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // The 7 carousel labels from FEATURE_TABS in features-tabs.tsx.
    // If a tab is renamed/removed at the composition layer, this catches it.
    expect(html).toContain("Storefront &amp; Booking");
    expect(html).toContain("Payments on autopilot");
    expect(html).toContain("Files &amp; Feedback");
    expect(html).toContain("Client history");
    expect(html).toContain("Follow-up on autopilot");
    expect(html).toContain("Lead Management");
    expect(html).toContain("Contracts &amp; Protection");
  });

  it("every primary 'Sign up now' CTA points at /sign-up?redirect_url=%2Fonboarding", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // Count Sign-up href occurrences. Minimum sources:
    //   - Nav (desktop "Sign up now" Link)
    //   - Hero (primary CTA)
    //   - Pricing (Sign up now → CTA)
    //   - FinalCTA (closing CTA)
    // The mobile-menu CTA in landing-nav only renders when the menu is
    // toggled open (useState=false on first render), so we don't count
    // it here.
    const signUpHref = 'href="/sign-up?redirect_url=%2Fonboarding"';
    const matches = html.match(new RegExp(escapeRegExp(signUpHref), "g")) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it("'Sign in' link points at /sign-in (nav-only)", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // /sign-in appears once on the page — only in the nav. The mobile
    // menu's /sign-in link is not rendered by default (menuOpen=false),
    // so a single occurrence pins the desktop nav surface.
    const signInMatches = html.match(/href="\/sign-in"/g) ?? [];
    expect(signInMatches.length).toBe(1);
    // And the link text is literally "Sign in".
    expect(html).toMatch(/href="\/sign-in"[^>]*>\s*Sign in\s*</);
  });

  it("contains NO fabricated social proof or waitlist copy", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // Every variant of the original "Join The Waiting List" / "1,200+
    // producers" / "Get Early Access" copy that the source HTML used.
    // PRD §3.5 dropped them — pinning here so a future copy refresh
    // doesn't accidentally reintroduce a fabricated metric.
    expect(html).not.toContain("1,200");
    expect(html).not.toContain("1200+");
    expect(html).not.toMatch(/Join the Waiting List/i);
    expect(html).not.toMatch(/Join The Waiting List/i);
    expect(html).not.toMatch(/Join Waitlist/i);
    expect(html).not.toMatch(/waitlist/i);
    expect(html).not.toMatch(/Get Early Access/i);
    expect(html).not.toMatch(/Claim Early Access/i);
  });

  it("wraps dark-themed sections in <main className=\"dark-world\">", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // React serializes className as `class` in the HTML output. The
    // dark-world wrapper bundles pain → download (12 dark sections);
    // the light-themed sections (hero, trust-bar, final-cta, footer)
    // sit outside it. If this wrapper is removed or renamed, the dark
    // palette stops applying via .landing-root .dark-world in
    // landing.css.
    expect(html).toContain('<main class="dark-world">');
  });

  it("renders NoiseOverlay as the first child of .landing-root", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // The noise-overlay div MUST sit at the top of the .landing-root
    // tree so its fixed-position SVG film grain composites above every
    // section. Pinning the literal opening sequence catches accidental
    // reordering.
    expect(html).toMatch(/^<div class="landing-root"><div class="noise-overlay"/);
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
