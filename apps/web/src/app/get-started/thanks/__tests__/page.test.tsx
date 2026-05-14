import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type AuthResult = { userId: string | null };
const authMock = vi.fn<() => Promise<AuthResult>>();
const redirectMock = vi.fn((path: string) => {
  // Mirror Next's behavior — redirect() throws to halt rendering.
  throw new Error(`__REDIRECT__:${path}`);
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import ThanksPage from "../page";

describe("English /get-started/thanks page", () => {
  it("shows greeting with name when ?n=Yuval is provided", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    const ui = await ThanksPage({
      searchParams: Promise.resolve({ n: "Yuval" }),
    });
    const html = renderToStaticMarkup(ui);
    // Note: the period is rendered in a separate <span class="accent-dot">
    // for the brand amber dot. We assert presence of the name + the
    // amber-dot span, not the literal "You're in, Yuval." string.
    expect(html).toMatch(/You&#x27;re in, Yuval/);
    expect(html).toMatch(/<span class="accent-dot">\./);
  });

  it("falls back to no-name greeting when ?n is absent", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    const ui = await ThanksPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(ui);
    // "You're in" with no trailing name (no comma + name) — the
    // period is a separate span. Comma must NOT appear.
    expect(html).toMatch(/You&#x27;re in</);
    expect(html).not.toMatch(/You&#x27;re in,/);
  });

  it("strips HTML/special chars from the name param", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    const ui = await ThanksPage({
      searchParams: Promise.resolve({ n: "<script>alert(1)</script>" }),
    });
    const html = renderToStaticMarkup(ui);
    // The name sanitizer strips angle brackets + parens; nothing
    // resembling a script tag survives. React's HTML escaping then
    // renders any leftover text as entities, so even malicious input
    // becomes inert.
    expect(html).not.toMatch(/<script\b/);
  });

  it("renders no outbound links to non-/get-started routes", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    const ui = await ThanksPage({
      searchParams: Promise.resolve({ n: "Yuval" }),
    });
    const html = renderToStaticMarkup(ui);
    // Match every <a href="..."> attribute and assert each href stays
    // on /get-started or is empty/anchor-only.
    const hrefs = [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1] ?? "");
    for (const href of hrefs) {
      const ok =
        href.startsWith("/get-started") || href === "" || href.startsWith("#");
      expect(ok, `forbidden off-funnel href: ${href}`).toBe(true);
    }
  });

  it("redirects signed-in producers to /dashboard", async () => {
    authMock.mockResolvedValueOnce({ userId: "user_123" });
    await expect(
      ThanksPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("__REDIRECT__:/dashboard");
  });
});
