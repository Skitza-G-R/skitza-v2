import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthHero } from "../auth-hero";

// AuthHero mirrors the locked design source's per-page hero block
// (`/tmp/skitza-design/tabs/auth.jsx` — `SignInScreen`, `SignUpScreen`,
// `VerifyScreen`). The shared component has a few invariants the
// design depends on, and they're all marked-up assertions cheap to
// pin in a static-render test:
//
//   1. Eyebrow uses font-mono uppercase + 0.18em tracking — the
//      "label" voice on every authenticated surface.
//   2. Title uses font-syne (Skitza's display family) — the locked
//      design's heading typeface.
//   3. The amber period is a separate sibling span so it can take a
//      different colour without breaking the heading's screen-reader
//      semantics. Marked aria-hidden because it's pure decoration.
describe("AuthHero", () => {
  it("renders the eyebrow as font-mono uppercase tracked text", () => {
    const html = renderToStaticMarkup(
      <AuthHero eyebrow="Sign in" title="Welcome back" blurb="Subtitle." />,
    );
    expect(html).toContain("font-mono");
    expect(html).toContain("uppercase");
    expect(html).toContain("tracking-[0.18em]");
    expect(html).toContain("Sign in");
  });

  it("renders the title with the Syne display face", () => {
    const html = renderToStaticMarkup(
      <AuthHero eyebrow="Sign in" title="Welcome back" blurb="Subtitle." />,
    );
    expect(html).toContain("font-syne");
    expect(html).toContain("Welcome back");
  });

  it("appends the brand-amber period as an aria-hidden sibling span", () => {
    const html = renderToStaticMarkup(
      <AuthHero eyebrow="Sign in" title="Welcome back" blurb="Subtitle." />,
    );
    // The period is a separate <span> rather than baked into the
    // string so the colour can diverge from the heading without
    // breaking the screen-reader text.
    expect(html).toMatch(/aria-hidden[^>]*>\.<\/span>/);
    expect(html).toContain("rgb(var(--brand-primary))");
  });

  it("can preserve question and loading punctuation without adding another period", () => {
    const question = renderToStaticMarkup(
      <AuthHero
        eyebrow="Artist mode"
        title="Join Northline as an Artist?"
        blurb="Your Producer workspace stays as it is."
        showAccentPeriod={false}
      />,
    );
    const loading = renderToStaticMarkup(
      <AuthHero
        eyebrow="Booking"
        title="Opening Northline…"
        blurb="Taking you straight to booking."
        showAccentPeriod={false}
      />,
    );

    expect(question).toContain("Join Northline as an Artist?");
    expect(question).not.toContain("Artist?.");
    expect(loading).toContain("Opening Northline…");
    expect(loading).not.toContain("Northline….");
  });

  it("renders the blurb in fg-secondary", () => {
    const html = renderToStaticMarkup(
      <AuthHero eyebrow="Sign in" title="Welcome back" blurb="Pick up where you left off." />,
    );
    expect(html).toContain("rgb(var(--fg-secondary))");
    expect(html).toContain("Pick up where you left off.");
  });

  it("wraps long studio names and supporting copy instead of clipping on phones", () => {
    const longStudioName = "VeryLongStudioName".repeat(5);
    const html = renderToStaticMarkup(
      <AuthHero
        eyebrow="Booking"
        title={`Continue to ${longStudioName}`}
        blurb={`Continue with ${longStudioName}.`}
      />,
    );

    expect(html.match(/\[overflow-wrap:anywhere\]/g)).toHaveLength(2);
  });
});
