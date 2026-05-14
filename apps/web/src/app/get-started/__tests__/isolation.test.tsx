import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Cross-page guard for the dead-end-funnel rule (design doc §3.5).
// Any future PR that adds a link from the rendered ad pages to a
// non-/get-started route will fail this test with a descriptive
// message naming the offending href.
//
// We render both EN and HE pages here. The thanks pages have their
// own per-file isolation assertions in their respective tests.

type AuthResult = { userId: string | null };
const authMock = vi.fn<() => Promise<AuthResult>>(() =>
  Promise.resolve({ userId: null }),
);

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: () => undefined,
  useRouter: () => ({ push: () => undefined }),
}));

import GetStartedPage from "../page";
import GetStartedPageHe from "../he/page";

// Allowed hrefs: in-funnel routes ("/get-started" prefix), in-page
// anchors ("#..."), and the literal empty string (no-op anchor that
// renders as `href=""`). NOTE: do NOT use `""` as a `startsWith`
// prefix — every string starts with the empty string and the check
// becomes a no-op. We treat `""` and `"#"` as exact matches and
// only `"/get-started"` as a prefix.
function isAllowedHref(href: string): boolean {
  if (href === "" || href === "#") return true;
  if (href.startsWith("#")) return true;
  if (href.startsWith("/get-started")) return true;
  return false;
}

function assertNoOffFunnelLinks(html: string) {
  const hrefs = [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map(
    (m) => m[1] ?? "",
  );
  for (const href of hrefs) {
    expect(
      isAllowedHref(href),
      `Off-funnel link <a href="${href}"> on the ad page — violates §3.5 isolation rule`,
    ).toBe(true);
  }
}

describe("Ad funnel isolation (§3.5)", () => {
  it("English page has no off-funnel links", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    const ui = await GetStartedPage();
    const html = renderToStaticMarkup(ui);
    assertNoOffFunnelLinks(html);
  });

  it("Hebrew page has no off-funnel links", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    const ui = await GetStartedPageHe();
    const html = renderToStaticMarkup(ui);
    assertNoOffFunnelLinks(html);
  });
});
