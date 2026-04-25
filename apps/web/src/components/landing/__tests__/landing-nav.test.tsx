import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LandingNav, NAV_LINKS } from "../landing-nav";

// Tests for the landing top nav (S2 — landing-restore).
//
// Pinning the NAV_LINKS contract + asserting on rendered hrefs via
// renderToStaticMarkup. No React Testing Library — the repo convention
// is data-contract pinning. The mobile-menu open state is tested by
// confirming the disclosure markup is present (initial render = closed
// menu; the toggle is a `<details>` element and naturally state-tracked
// without needing JS interactivity in tests).

describe("LandingNav — landing top nav (S2)", () => {
  it("exposes the 3 anchor nav links in source order", () => {
    expect(NAV_LINKS.map((l) => l.label)).toEqual([
      "Features",
      "How It Works",
      "Pricing",
    ]);
  });

  it("each nav link is an in-page anchor", () => {
    expect(NAV_LINKS.map((l) => l.href)).toEqual([
      "#features",
      "#how-it-works",
      "#pricing",
    ]);
  });

  it("Sign In link points at /sign-in", () => {
    const html = renderToStaticMarkup(<LandingNav />);
    expect(html).toContain('href="/sign-in"');
    expect(html).toMatch(/Sign in/i);
  });

  it("Sign Up button points at /sign-up?redirect_url=%2Fonboarding", () => {
    const html = renderToStaticMarkup(<LandingNav />);
    expect(html).toContain('href="/sign-up?redirect_url=%2Fonboarding"');
    expect(html).toMatch(/Sign up now/i);
  });

  it("renders a mobile menu toggle button", () => {
    const html = renderToStaticMarkup(<LandingNav />);
    // The mobile-menu-btn class is the toggle hook (CSS-driven open
    // state via the `open` boolean).
    expect(html).toContain("mobile-menu-btn");
  });

  it("the desktop nav links list uses .nav-links + .nav-link classes", () => {
    const html = renderToStaticMarkup(<LandingNav />);
    expect(html).toContain('class="nav-links"');
    expect(html).toContain('class="nav-link"');
  });
});
