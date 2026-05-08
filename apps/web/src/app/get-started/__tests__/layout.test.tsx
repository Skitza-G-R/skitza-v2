import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import GetStartedLayout, { metadata } from "../layout";

// The /get-started layout is the architectural enforcement of the
// dead-end-funnel rule (design doc §3.5). It MUST render children
// only — no global nav, footer, or clickable logo. Any of those
// elements creates a conversion leak and breaks the funnel premise.
//
// In-repo testing convention: node-env vitest + renderToStaticMarkup
// (see apps/web/src/app/__tests__/landing-page.test.tsx). We render
// to HTML string and assert structural absence of the forbidden tags.

describe("get-started layout", () => {
  it("renders children only — no nav, no footer, no header", () => {
    const html = renderToStaticMarkup(
      GetStartedLayout({
        children: <div data-testid="child">child-marker</div>,
      }) as React.ReactElement,
    );
    expect(html).toContain("child-marker");
    expect(html).not.toMatch(/<nav\b/);
    expect(html).not.toMatch(/<footer\b/);
    expect(html).not.toMatch(/<header\b/);
  });

  it("sets noindex+nofollow on the route", () => {
    expect(metadata.robots).toEqual({
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    });
  });
});
