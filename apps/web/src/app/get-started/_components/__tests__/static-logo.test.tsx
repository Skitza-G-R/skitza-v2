import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { StaticLogo } from "../static-logo";

// The logo on the ad funnel is brand recognition only — NEVER a link
// to anywhere else on the site. Wrapping it in <a> or [role="link"]
// would create an off-funnel click target and break the dead-end
// premise (design doc §3.5).
//
// renderToStaticMarkup (node-env vitest convention) — string asserts
// pin the structural rule.

describe("StaticLogo", () => {
  it("renders the brand mark with an aria-label", () => {
    const html = renderToStaticMarkup(<StaticLogo />);
    expect(html).toMatch(/aria-label="Skitza"/);
  });

  it("is NOT wrapped in a link (isolation rule §3.5)", () => {
    const html = renderToStaticMarkup(<StaticLogo />);
    expect(html).not.toMatch(/<a\b/);
    expect(html).not.toMatch(/role="link"/);
  });
});
