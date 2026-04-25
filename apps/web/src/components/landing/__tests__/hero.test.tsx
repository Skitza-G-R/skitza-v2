import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Hero, HERO_TITLE_WORDS } from "../hero";

// Tests for the Hero (S2 — landing-restore).
//
// Pinning the title-word array + rendered structural assertions via
// renderToStaticMarkup. The word-by-word fade is purely declarative:
// each word renders inside a `<span class="hero-word">` with a
// transition-delay style. The `.page-loaded` class is added on mount
// via useEffect — not asserted here (it's the trigger, not the
// structure).

describe("Hero — landing hero (S2)", () => {
  it("the headline 'Stop chasing payments. Just make music.' splits into words", () => {
    // The two phrases from the source HTML — line 1 ends with a
    // sentence; line 2 begins with 'Just' which forces a <br />.
    expect(HERO_TITLE_WORDS).toEqual([
      "Stop",
      "chasing",
      "payments.",
      "Just",
      "make",
      "music.",
    ]);
  });

  it("renders each title word inside a .hero-word span", () => {
    const html = renderToStaticMarkup(<Hero />);
    // Each of the 6 words has a hero-word span wrapper.
    const matches = html.match(/class="hero-word"/g) ?? [];
    expect(matches.length).toBe(6);
  });

  it("inserts a <br /> before 'Just' to split the headline across two lines", () => {
    const html = renderToStaticMarkup(<Hero />);
    // The break sits immediately before the 'Just' word — no other
    // <br/> in between the title spans.
    expect(html).toMatch(/<br\/?>\s*<span class="hero-word"[^>]*>Just<\/span>/);
  });

  it("primary CTA points at /sign-up?redirect_url=%2Fonboarding", () => {
    const html = renderToStaticMarkup(<Hero />);
    expect(html).toContain('href="/sign-up?redirect_url=%2Fonboarding"');
    expect(html).toMatch(/Sign up now/i);
  });

  it("secondary CTA is an anchor link to #pain (not an onclick handler)", () => {
    const html = renderToStaticMarkup(<Hero />);
    expect(html).toContain('href="#pain"');
    expect(html).toMatch(/See how it works/i);
    // Defensive: no inline onclick handlers (those don't transfer to React).
    expect(html).not.toContain("onclick");
  });

  it("social-proof line says 'Built for solo producers' (NOT '1,200+')", () => {
    const html = renderToStaticMarkup(<Hero />);
    expect(html).toContain("Built for solo producers");
    expect(html).not.toContain("1,200");
  });

  it("renders the headline h1 with id='hero-title' and the .syne class", () => {
    const html = renderToStaticMarkup(<Hero />);
    expect(html).toMatch(/<h1[^>]*id="hero-title"[^>]*class="syne"/);
  });
});
