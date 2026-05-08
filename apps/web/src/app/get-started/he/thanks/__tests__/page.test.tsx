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
}));

import ThanksPageHe from "../page";

describe("Hebrew /get-started/he/thanks page", () => {
  it("shows Hebrew greeting with name when ?n=יובל is provided", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    const ui = await ThanksPageHe({
      searchParams: Promise.resolve({ n: "יובל" }),
    });
    const html = renderToStaticMarkup(ui);
    expect(html).toMatch(/אתה בפנים, יובל/);
  });

  it("wraps content in dir='rtl' lang='he'", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    const ui = await ThanksPageHe({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(ui);
    expect(html).toMatch(/dir="rtl"/);
    expect(html).toMatch(/lang="he"/);
  });
});
