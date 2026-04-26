import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Page-level test for the landing route after the PR #50 pivot
// (single-file verbatim port — see
// `apps/web/src/components/landing/landing-page.tsx`).
//
// Pins the same composition contract that the previous 17-component
// build pinned, against the new single-component output:
//   1. Auth redirect — signed-in producers MUST land on /dashboard
//      and the landing markup MUST NOT render at all.
//   2. Section composition for signed-out visitors — every section's
//      distinguishing landmark is present in the rendered markup, in
//      order. The 11 source sections + 6 injected sections are now
//      sibling JSX in landing-page.tsx; the test asserts each id /
//      class fingerprint is present.
//   3. CTA wiring + absence of fabricated social proof.
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

describe("HomePage (landing) — composition (post-pivot)", () => {
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
    // corresponding section rendered. Order in this list mirrors the
    // composition order in landing-page.tsx.

    // 1. Nav — id="navbar"
    expect(html).toContain('id="navbar"');
    // 2. Hero — primary headline word sequence
    expect(html).toContain("Stop chasing payments.");
    // 3. TrustBar — "As featured in" eyebrow
    expect(html).toContain("As featured in");
    // 4. Pain — section id="pain"
    expect(html).toContain('id="pain"');
    // 5. Solution — section id="solution"
    expect(html).toContain('id="solution"');
    // 6. Compare — section id="compare"
    expect(html).toContain('id="compare"');
    // 7. Features — section id="features"
    expect(html).toContain('id="features"');
    // 8. Consolidation — section id="consolidation"
    expect(html).toContain('id="consolidation"');
    // 9. HowItWorks — section id="how-it-works"
    expect(html).toContain('id="how-it-works"');
    // 10. Security — section id="security"
    expect(html).toContain('id="security"');
    // 11. Testimonials — section id="testimonials"
    expect(html).toContain('id="testimonials"');
    // 12. Pricing — section id="pricing"
    expect(html).toContain('id="pricing"');
    // 13. FAQ — section id="faq"
    expect(html).toContain('id="faq"');
    // 14. Founder — section id="founder"
    expect(html).toContain('id="founder"');
    // 15. Download — section id="download"
    expect(html).toContain('id="download"');
    // 16. FinalCTA — class "final-cta"
    expect(html).toContain('class="final-cta"');
    // 17. Footer — <footer> element
    expect(html).toContain("<footer>");

    // Composition wrapper — outermost div is .landing-root
    expect(html).toMatch(/^<div class="landing-root">/);
  });

  it("renders all 7 feature tab labels", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // The 7 carousel labels in the features section. If a tab is
    // renamed/removed, this catches it.
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
    const signUpHref = 'href="/sign-up?redirect_url=%2Fonboarding"';
    const matches = html.match(new RegExp(escapeRegExp(signUpHref), "g")) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it("'Sign in' link points at /sign-in (nav-only)", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // /sign-in appears once on the page — only in the nav. Pinning a
    // single occurrence ensures we don't add stray sign-in CTAs in
    // other surfaces (the rest should drive sign-up).
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
    // The replacement social-proof line MUST be present.
    expect(html).toContain("Built for solo producers.");
  });

  it("wraps dark-themed sections in <main className=\"dark-world\">", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // React serializes className as `class` in the HTML output. The
    // dark-world wrapper bundles pain → footer; the light-themed
    // sections (hero, trust-bar, theme-transition) sit outside it.
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

  it("does NOT render the lead-capture modal (PRD §3.5)", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // The source HTML shipped a `<div class="modal-overlay">` lead
    // capture form. PRD §3.5 dropped it — every CTA goes to
    // /sign-up?redirect_url=/onboarding instead.
    expect(html).not.toContain("modal-overlay");
    expect(html).not.toContain("signupModal");
    expect(html).not.toContain("modal-box");
    expect(html).not.toContain("Get Early Access");
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
