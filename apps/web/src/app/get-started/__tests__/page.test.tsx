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

  it("renders sections in order: hero, cascade, founder, cta", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    const ui = await GetStartedPage();
    const html = renderToStaticMarkup(ui);
    // Each section has a stable id used for in-page anchors and
    // testing. The standalone "demo" section was folded into the
    // hero (right column) post-redesign — the demo iframe is part
    // of the hero now, not a separate scroll surface.
    const idxHero = html.indexOf('id="hero"');
    const idxCascade = html.indexOf('id="cascade"');
    const idxFounder = html.indexOf('id="founder"');
    const idxCta = html.indexOf('id="cta"');
    expect(idxHero).toBeGreaterThanOrEqual(0);
    expect(idxCascade).toBeGreaterThan(idxHero);
    expect(idxFounder).toBeGreaterThan(idxCascade);
    expect(idxCta).toBeGreaterThan(idxFounder);
  });
});
