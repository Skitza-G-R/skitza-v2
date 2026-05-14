import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type AuthResult = { userId: string | null };
const authMock = vi.fn<() => Promise<AuthResult>>();
const redirectMock = vi.fn((path: string) => {
  throw new Error(`__REDIRECT__:${path}`);
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
  useRouter: () => ({ push: () => undefined }),
}));

import GetStartedPageHe from "../page";

describe("Hebrew /get-started/he page", () => {
  it("wraps content in dir='rtl' lang='he' on a div, NOT root <html>", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    const ui = await GetStartedPageHe();
    const html = renderToStaticMarkup(ui);
    expect(html).toMatch(/<div[^>]*lang="he"[^>]*dir="rtl"|<div[^>]*dir="rtl"[^>]*lang="he"/);
    expect(html).not.toMatch(/<html\b/);
  });

  it("renders Hebrew hero copy", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    const ui = await GetStartedPageHe();
    const html = renderToStaticMarkup(ui);
    // Hero headline is split into per-word <span class="hero-word">
    // for the page-loaded fade stagger, so each word lives in its
    // own span. The h1 itself uses the homepage's font-syne utility
    // (not a `.h1` brand class). Assert tag + each word.
    expect(html).toMatch(/<h1\b/);
    expect(html).toMatch(/אתה/);
    expect(html).toMatch(/מפיק/);
    expect(html).toMatch(/לא/);
    expect(html).toMatch(/מזכירה/);
  });

  it("redirects signed-in users to /dashboard", async () => {
    authMock.mockResolvedValueOnce({ userId: "user_123" });
    await expect(GetStartedPageHe()).rejects.toThrow("__REDIRECT__:/dashboard");
  });
});
