import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Page-level test for the landing route — Phase 3 v3 (replaces the
// PR #50 verbatim-port test pinning the old `pain` / `solution` /
// `compare` / `consolidation` / `download` section IDs).
//
// Pins the same composition contract that the PR #50 build pinned,
// against the v3 single-component output:
//   1. Auth redirect — signed-in producers MUST land on /dashboard
//      and the landing markup MUST NOT render at all.
//   2. Section composition for signed-out visitors — every section's
//      distinguishing landmark is present in the rendered markup, in
//      order. The 11 v3 sections are sibling JSX in landing-page.tsx;
//      this test asserts each id / class fingerprint is present.
//   3. CTA wiring — every primary signup CTA points at
//      /sign-up?redirect_url=/onboarding (PRD §3.5: no waitlist; all
//      CTAs drive sign-up directly, even though the v3 design source
//      offered a WaitlistModal — the modal was retired in this port).
//      Visible CTA text is "Start free trial" (the prior "Get demo
//      access" copy was bait-and-switch since the destination is the
//      sign-up form, not a demo).
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

describe("HomePage (landing) — composition (Phase 3 v3)", () => {
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
    expect(html).toContain("Contracts that sign themselves");
    expect(html).toContain("Client history, all in one place");
    expect(html).toContain("Lead pipeline that doesn");
    expect(html).toContain("Files stay yours");
    expect(html).toContain("One link, every channel");
    expect(html).toContain("Works on every device");
  });

  it("renders all 3 alternating feature-hero titles", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    expect(html).toContain("Stop running your studio out of WhatsApp.");
    expect(html).toContain("Stream freely. Download when paid.");
    // Apostrophe encodes as &#x27; in renderToStaticMarkup, so match
    // the literal-encoded form rather than the curly-apostrophe.
    expect(html).toMatch(/reminders you.{1,8}d never send/i);
  });

  it("every primary signup CTA points at /sign-up?redirect_url=%2Fonboarding", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // Count Sign-up href occurrences. Minimum surfaces:
    //   - Nav desktop CTA
    //   - Nav mobile menu CTA (rendered always; hidden by .lg:hidden)
    //   - Hero primary CTA
    //   - Pricing CTA
    //   - FinalCTA
    // The mobile menu fold-out only renders when `menuOpen` is true,
    // so it's NOT in the static SSR output (initial `menuOpen=false`).
    // That leaves 4 surfaces in SSR.
    const signUpHref = 'href="/sign-up?redirect_url=%2Fonboarding"';
    const matches = html.match(new RegExp(escapeRegExp(signUpHref), "g")) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it("'Sign in' link points at /sign-in (nav-only)", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // /sign-in appears once in SSR (nav desktop). Mobile nav fold-out
    // is gated by `menuOpen=false` and not rendered in the SSR pass.
    const signInMatches = html.match(/href="\/sign-in"/g) ?? [];
    expect(signInMatches.length).toBe(1);
    // And the link text is literally "Sign in".
    expect(html).toMatch(/href="\/sign-in"[^>]*>\s*Sign in\s*</);
  });

  it("contains NO waitlist copy (PRD §3.5 — design source's WaitlistModal retired)", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // The v3 design source uses a WaitlistModal triggered by every
    // "Get demo access" CTA. PRD §3.5 retired all waitlist concepts —
    // every CTA drives sign-up directly. Pinning here so a future port
    // doesn't accidentally reintroduce the modal.
    expect(html).not.toMatch(/Join the Waiting List/i);
    expect(html).not.toMatch(/Join Waitlist/i);
    expect(html).not.toMatch(/waitlist/i);
    expect(html).not.toMatch(/Reserve my spot/i);
    expect(html).not.toMatch(/Get Early Access/i);
  });

  it("renders the v3 founder note social-proof line", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { default: HomePage } = await import("../page");
    const ui = await HomePage();
    const html = renderToStaticMarkup(ui);

    // The founder note quotes the "$4k mix" origin story — pinning
    // this catches accidental copy regressions when the next phase
    // touches the founder section.
    expect(html).toContain("losing a $4k mix");
    expect(html).toContain("Gili Asraf");
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
