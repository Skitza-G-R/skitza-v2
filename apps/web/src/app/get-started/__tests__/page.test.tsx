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

import GetStartedPage from "../page";

describe("English /get-started page", () => {
  it("redirects signed-in users to /dashboard", async () => {
    authMock.mockResolvedValueOnce({ userId: "user_123" });
    await expect(GetStartedPage()).rejects.toThrow("__REDIRECT__:/dashboard");
  });

  it("renders 5 distinct sections in order: hero, demo, cascade, founder, cta", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    const ui = await GetStartedPage();
    const html = renderToStaticMarkup(ui);
    // Each section has a stable id used for in-page anchors and
    // testing. Asserting their *relative order* in the rendered HTML
    // pins the section sequence specified in design doc §4.
    const idxHero = html.indexOf('id="hero"');
    const idxDemo = html.indexOf('id="demo"');
    const idxCascade = html.indexOf('id="cascade"');
    const idxFounder = html.indexOf('id="founder"');
    const idxCta = html.indexOf('id="cta"');
    expect(idxHero).toBeGreaterThanOrEqual(0);
    expect(idxDemo).toBeGreaterThan(idxHero);
    expect(idxCascade).toBeGreaterThan(idxDemo);
    expect(idxFounder).toBeGreaterThan(idxCascade);
    expect(idxCta).toBeGreaterThan(idxFounder);
  });
});
